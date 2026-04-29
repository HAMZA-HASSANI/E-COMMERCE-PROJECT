const express = require('express');
const { Pool } = require('pg');
const redis = require('redis');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const promClient = require('prom-client');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// ─── PROMETHEUS METRICS ─────────────────────────────────────────────────────────
const collectDefaultMetrics = promClient.collectDefaultMetrics;
collectDefaultMetrics({ prefix: 'product_service_' });

const httpRequestDuration = new promClient.Histogram({
  name: 'product_service_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]
});

const httpRequestTotal = new promClient.Counter({
  name: 'product_service_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code']
});

const cacheHits = new promClient.Counter({
  name: 'product_service_cache_hits_total',
  help: 'Total number of Redis cache hits'
});

const cacheMisses = new promClient.Counter({
  name: 'product_service_cache_misses_total',
  help: 'Total number of Redis cache misses'
});

// ─── DATABASE CONNECTION ────────────────────────────────────────────────────────
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  host: process.env.DB_HOST || 'postgres',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'ecommerce',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => console.error('Unexpected pool error:', err));

// ─── REDIS CLIENT ───────────────────────────────────────────────────────────────
const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
let redisClient;
const CACHE_TTL = parseInt(process.env.CACHE_TTL || '3600', 10);

async function connectRedis() {
  try {
    redisClient = redis.createClient({ url: REDIS_URL });
    redisClient.on('error', (err) => console.error('Redis error:', err));
    await redisClient.connect();
    console.log('Connected to Redis');
  } catch (err) {
    console.error('Redis connection failed:', err.message);
    redisClient = null;
  }
}
connectRedis();

// ─── MIDDLEWARE ──────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json({ limit: '1mb' }));

// Metrics middleware
app.use((req, res, next) => {
  if (req.path === '/metrics' || req.path === '/health') return next();
  const end = httpRequestDuration.startTimer();
  res.on('finish', () => {
    const route = req.route ? req.route.path : req.path;
    end({ method: req.method, route, status_code: res.statusCode });
    httpRequestTotal.inc({ method: req.method, route, status_code: res.statusCode });
  });
  next();
});

// ─── PROMETHEUS METRICS ENDPOINT ────────────────────────────────────────────────
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', promClient.register.contentType);
  res.end(await promClient.register.metrics());
});

// ─── HEALTH CHECK ───────────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    const redisOk = redisClient ? await redisClient.ping().then(() => true).catch(() => false) : false;
    res.json({
      status: 'Product Service is running',
      timestamp: result.rows[0].now,
      dependencies: { postgres: true, redis: redisOk }
    });
  } catch (err) {
    res.status(500).json({ error: 'Database connection failed' });
  }
});

// ─── CACHE HELPERS ──────────────────────────────────────────────────────────────
async function cacheGet(key) {
  if (!redisClient) return null;
  try {
    const data = await redisClient.get(key);
    if (data) { cacheHits.inc(); return JSON.parse(data); }
    cacheMisses.inc();
  } catch (err) { console.error('Redis GET error:', err.message); }
  return null;
}

async function cacheSet(key, value, ttl = CACHE_TTL) {
  if (!redisClient) return;
  try { await redisClient.setEx(key, ttl, JSON.stringify(value)); }
  catch (err) { console.error('Redis SET error:', err.message); }
}

async function cacheInvalidate(pattern) {
  if (!redisClient) return;
  try {
    const keys = await redisClient.keys(pattern);
    if (keys.length > 0) await redisClient.del(keys);
  } catch (err) { console.error('Redis invalidation error:', err.message); }
}

// ─── GET ALL PRODUCTS (pagination + search + cache) ─────────────────────────────
app.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const search = req.query.search ? req.query.search.trim() : null;
    const sortBy = ['name', 'price', 'created_at', 'stock'].includes(req.query.sort) ? req.query.sort : 'created_at';
    const order = req.query.order === 'asc' ? 'ASC' : 'DESC';

    const cacheKey = `products:list:p=${page}:l=${limit}:s=${search || ''}:sb=${sortBy}:o=${order}`;

    const cached = await cacheGet(cacheKey);
    if (cached) return res.json(cached);

    let countQuery = 'SELECT COUNT(*) FROM products';
    let dataQuery = `SELECT * FROM products`;
    const params = [];

    if (search) {
      countQuery += ` WHERE name ILIKE $1 OR description ILIKE $1`;
      dataQuery += ` WHERE name ILIKE $1 OR description ILIKE $1`;
      params.push(`%${search}%`);
    }

    dataQuery += ` ORDER BY ${sortBy} ${order} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const countResult = await pool.query(countQuery, search ? [`%${search}%`] : []);
    const total = parseInt(countResult.rows[0].count, 10);
    const result = await pool.query(dataQuery, params);

    const response = {
      products: result.rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    };

    await cacheSet(cacheKey, response);
    res.json(response);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// ─── GET PRODUCT BY ID ──────────────────────────────────────────────────────────
app.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid product ID' });

    const cached = await cacheGet(`products:detail:${id}`);
    if (cached) return res.json(cached);

    const result = await pool.query('SELECT * FROM products WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Product not found' });

    await cacheSet(`products:detail:${id}`, result.rows[0]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

// ─── CREATE PRODUCT ─────────────────────────────────────────────────────────────
app.post('/', async (req, res) => {
  try {
    const { name, description, price, stock } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0)
      return res.status(400).json({ error: 'Product name is required' });
    if (price === undefined || isNaN(price) || Number(price) < 0)
      return res.status(400).json({ error: 'Valid price is required (>= 0)' });
    if (stock !== undefined && (isNaN(stock) || Number(stock) < 0))
      return res.status(400).json({ error: 'Stock must be a non-negative integer' });

    const result = await pool.query(
      'INSERT INTO products (name, description, price, stock) VALUES ($1, $2, $3, $4) RETURNING *',
      [name.trim(), description || null, Number(price), Number(stock) || 0]
    );

    await cacheInvalidate('products:list:*');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create product' });
  }
});

// ─── UPDATE PRODUCT ─────────────────────────────────────────────────────────────
app.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid product ID' });
    const { name, description, price, stock } = req.body;
    if (price !== undefined && (isNaN(price) || Number(price) < 0))
      return res.status(400).json({ error: 'Valid price is required (>= 0)' });

    const result = await pool.query(
      `UPDATE products SET
        name = COALESCE($1, name), description = COALESCE($2, description),
        price = COALESCE($3, price), stock = COALESCE($4, stock),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $5 RETURNING *`,
      [name || null, description || null, price !== undefined ? Number(price) : null,
       stock !== undefined ? Number(stock) : null, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Product not found' });

    await cacheInvalidate('products:*');
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

// ─── DELETE PRODUCT ─────────────────────────────────────────────────────────────
app.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid product ID' });

    const result = await pool.query('DELETE FROM products WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Product not found' });

    await cacheInvalidate('products:*');
    res.json({ message: 'Product deleted', id: parseInt(id) });
  } catch (err) {
    if (err.code === '23503') {
      return res.status(409).json({ error: 'Cannot delete product: it is referenced by existing orders' });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

// ─── ERROR HANDLER ──────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

// ─── START & SHUTDOWN ───────────────────────────────────────────────────────────
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Product Service listening on port ${PORT}`);
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  server.close(async () => {
    await pool.end();
    if (redisClient) await redisClient.quit();
    process.exit(0);
  });
});

module.exports = app; // Export for testing
