const express = require('express');
const httpProxy = require('express-http-proxy');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const redis = require('redis');
const axios = require('axios');
const promClient = require('prom-client');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ─── PROMETHEUS METRICS ─────────────────────────────────────────────────────────
const collectDefaultMetrics = promClient.collectDefaultMetrics;
collectDefaultMetrics({ prefix: 'api_gateway_' });

const httpRequestDuration = new promClient.Histogram({
  name: 'api_gateway_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]
});

const httpRequestTotal = new promClient.Counter({
  name: 'api_gateway_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code']
});

const rateLimitRejections = new promClient.Counter({
  name: 'api_gateway_rate_limit_rejections_total',
  help: 'Total number of rate limit rejections'
});

const authFailures = new promClient.Counter({
  name: 'api_gateway_auth_failures_total',
  help: 'Total number of authentication failures'
});

// Redis client for rate limiting
const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
let redisClient;

async function connectRedis() {
  try {
    redisClient = redis.createClient({ url: REDIS_URL });
    redisClient.on('error', (err) => console.error('Redis error:', err));
    await redisClient.connect();
    console.log('API Gateway connected to Redis');
  } catch (err) {
    console.error('Redis connection failed:', err.message);
    redisClient = null;
  }
}

connectRedis();

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(morgan('combined'));
app.use(express.json());

// Metrics middleware
app.use((req, res, next) => {
  if (req.path === '/metrics' || req.path === '/health') return next();
  const end = httpRequestDuration.startTimer();
  res.on('finish', () => {
    const route = req.path.split('/').slice(0, 3).join('/') || req.path;
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

// ─── RATE LIMITING MIDDLEWARE ───────────────────────────────────────────────────
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || '100', 10); // requests
const RATE_LIMIT_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW || '60', 10); // seconds

async function rateLimiter(req, res, next) {
  if (!redisClient) return next(); // Skip if Redis unavailable

  const identifier = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  const key = `ratelimit:${identifier}`;

  try {
    const current = await redisClient.incr(key);
    if (current === 1) {
      await redisClient.expire(key, RATE_LIMIT_WINDOW);
    }

    res.setHeader('X-RateLimit-Limit', RATE_LIMIT_MAX);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, RATE_LIMIT_MAX - current));

    if (current > RATE_LIMIT_MAX) {
      rateLimitRejections.inc();
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }

    next();
  } catch (err) {
    console.error('Rate limiter error:', err.message);
    next(); // Fail open
  }
}

app.use(rateLimiter);

// ─── JWT AUTHENTICATION MIDDLEWARE ──────────────────────────────────────────────
const USER_SERVICE = process.env.USER_SERVICE_URL || 'http://user-service:3002';

// Routes that do NOT require authentication
const PUBLIC_ROUTES = [
  { method: 'GET',  path: '/health' },
  { method: 'GET',  path: '/api' },
  { method: 'POST', path: '/api/users/register' },
  { method: 'POST', path: '/api/users/login' },
  { method: 'GET',  path: '/api/products' },
];

function isPublicRoute(method, path) {
  return PUBLIC_ROUTES.some(r =>
    r.method === method && (path === r.path || path.startsWith(r.path + '/') || path.startsWith(r.path + '?'))
  );
}

async function jwtAuth(req, res, next) {
  // Skip auth for public routes
  if (isPublicRoute(req.method, req.path)) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required. Please provide a valid Bearer token.' });
  }

  try {
    // Validate the token via User Service
    const response = await axios.get(`${USER_SERVICE}/validate`, {
      headers: { Authorization: authHeader },
      timeout: 5000
    });

    if (response.data && response.data.valid) {
      // Attach user info to request headers for downstream services
      req.headers['x-user-id'] = String(response.data.user.userId || response.data.user.id);
      req.headers['x-user-email'] = response.data.user.email;
      next();
    } else {
      res.status(401).json({ error: 'Invalid or expired token' });
    }
  } catch (err) {
    if (err.response && err.response.status === 401) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    console.error('Token validation error:', err.message);
    res.status(503).json({ error: 'Authentication service unavailable' });
  }
}

app.use(jwtAuth);

// ─── HEALTH CHECK ───────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'API Gateway is running',
    timestamp: new Date(),
    redis: !!redisClient
  });
});

// ─── SERVICE DISCOVERY ──────────────────────────────────────────────────────────
const PRODUCT_SERVICE = process.env.PRODUCT_SERVICE_URL || 'http://product-service:3001';
const ORDER_SERVICE = process.env.ORDER_SERVICE_URL || 'http://order-service:3003';

// ─── PROXY ROUTES ───────────────────────────────────────────────────────────────
app.use('/api/products', httpProxy(PRODUCT_SERVICE));
app.use('/api/users', httpProxy(USER_SERVICE));
app.use('/api/orders', httpProxy(ORDER_SERVICE));

// Root endpoint
app.get('/api', (req, res) => {
  res.json({
    message: 'E-commerce API Gateway',
    version: '1.1.0',
    services: {
      products: '/api/products',
      users: '/api/users',
      orders: '/api/orders'
    },
    authentication: 'Bearer token required for protected routes. Obtain via POST /api/users/login'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`API Gateway listening on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  server.close(async () => {
    if (redisClient) await redisClient.quit();
    process.exit(0);
  });
});
