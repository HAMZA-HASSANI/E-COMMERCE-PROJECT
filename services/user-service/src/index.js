const express = require('express');
const { Pool } = require('pg');
const redis = require('redis');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const promClient = require('prom-client');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3002;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '24h';

// Database connection with pool configuration
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

// Redis client for session cache
const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
let redisClient;
const SESSION_TTL = 86400; // 24 hours

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

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());

// Prometheus metrics
const collectDefaultMetrics = promClient.collectDefaultMetrics;
collectDefaultMetrics({ prefix: 'user_service_' });
const httpRequestDuration = new promClient.Histogram({
  name: 'user_service_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]
});
const httpRequestTotal = new promClient.Counter({
  name: 'user_service_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code']
});

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

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', promClient.register.contentType);
  res.end(await promClient.register.metrics());
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    const redisOk = redisClient ? await redisClient.ping().then(() => true).catch(() => false) : false;
    res.json({
      status: 'User Service is running',
      timestamp: result.rows[0].now,
      dependencies: { postgres: true, redis: redisOk }
    });
  } catch (err) {
    res.status(500).json({ error: 'Database connection failed' });
  }
});

// Email validation helper
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Register user
app.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    // Input validation
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ error: 'Valid email is required' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Name is required' });
    }

    // Check if user already exists
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name, created_at',
      [email.toLowerCase(), hashedPassword, name.trim()]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to register user' });
  }
});

// Login user
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRY }
    );

    // Store session in Redis
    if (redisClient) {
      try {
        await redisClient.setEx(`session:${token}`, SESSION_TTL, JSON.stringify({
          userId: user.id,
          email: user.email,
          name: user.name
        }));
      } catch (err) {
        console.error('Redis session store error:', err.message);
      }
    }

    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Validate token (used by API Gateway)
app.get('/validate', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ valid: false, error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];

    // Check Redis session first
    if (redisClient) {
      try {
        const session = await redisClient.get(`session:${token}`);
        if (session) {
          return res.json({ valid: true, user: JSON.parse(session) });
        }
      } catch (err) {
        console.error('Redis session lookup error:', err.message);
      }
    }

    // Fallback to JWT verification
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({ valid: true, user: { userId: decoded.userId, email: decoded.email } });
  } catch (err) {
    res.status(401).json({ valid: false, error: 'Invalid or expired token' });
  }
});

// Get all users (admin)
app.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, email, name, created_at FROM users ORDER BY created_at DESC');
    res.json({ users: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Get user by ID
app.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    const result = await pool.query('SELECT id, email, name, created_at FROM users WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// Update user profile
app.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    const { name, email } = req.body;
    if (email && !isValidEmail(email)) {
      return res.status(400).json({ error: 'Valid email is required' });
    }

    const result = await pool.query(
      `UPDATE users SET
        name = COALESCE($1, name),
        email = COALESCE($2, email),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $3 RETURNING id, email, name, updated_at`,
      [name || null, email ? email.toLowerCase() : null, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email already in use' });
    }
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`User Service listening on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  server.close(async () => {
    await pool.end();
    if (redisClient) await redisClient.quit();
    process.exit(0);
  });
});

module.exports = app;
