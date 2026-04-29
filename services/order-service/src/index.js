const express = require('express');
const { Pool } = require('pg');
const amqp = require('amqplib');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const promClient = require('prom-client');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3003;

// ─── PROMETHEUS METRICS ─────────────────────────────────────────────────────────
const collectDefaultMetrics = promClient.collectDefaultMetrics;
collectDefaultMetrics({ prefix: 'order_service_' });

const httpRequestDuration = new promClient.Histogram({
  name: 'order_service_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]
});
const httpRequestTotal = new promClient.Counter({
  name: 'order_service_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code']
});
const ordersCreated = new promClient.Counter({
  name: 'order_service_orders_created_total',
  help: 'Total number of orders created'
});

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

pool.on('error', (err) => console.error('Unexpected pool error:', err));

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());

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

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', promClient.register.contentType);
  res.end(await promClient.register.metrics());
});

// RabbitMQ connection
let channel;
let rabbitConnection;
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@rabbitmq:5672';

async function connectRabbitMQ() {
  try {
    rabbitConnection = await amqp.connect(RABBITMQ_URL);
    channel = await rabbitConnection.createChannel();
    await channel.assertExchange('orders', 'topic', { durable: true });
    console.log('Connected to RabbitMQ');

    rabbitConnection.on('close', () => {
      console.log('RabbitMQ connection closed, reconnecting...');
      channel = null;
      setTimeout(connectRabbitMQ, 5000);
    });
  } catch (err) {
    console.error('RabbitMQ connection failed:', err.message);
    setTimeout(connectRabbitMQ, 5000);
  }
}

connectRabbitMQ();

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({
      status: 'Order Service is running',
      timestamp: result.rows[0].now,
      dependencies: { postgres: true, rabbitmq: !!channel }
    });
  } catch (err) {
    res.status(500).json({ error: 'Database connection failed' });
  }
});

// Create order (with order_items and input validation)
app.post('/', async (req, res) => {
  const client = await pool.connect();
  try {
    const { userId, items } = req.body;

    // Input validation
    if (!userId || isNaN(userId)) {
      return res.status(400).json({ error: 'Valid userId is required' });
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'At least one item is required (items: [{productId, quantity}])' });
    }

    for (const item of items) {
      if (!item.productId || isNaN(item.productId)) {
        return res.status(400).json({ error: `Invalid productId: ${item.productId}` });
      }
      if (!item.quantity || isNaN(item.quantity) || item.quantity < 1) {
        return res.status(400).json({ error: `Invalid quantity for product ${item.productId}` });
      }
    }

    // Verify user exists
    const userCheck = await client.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Begin transaction
    await client.query('BEGIN');

    // Calculate total amount and validate products
    let totalAmount = 0;
    const resolvedItems = [];

    for (const item of items) {
      const productResult = await client.query(
        'SELECT id, name, price, stock FROM products WHERE id = $1 FOR UPDATE',
        [item.productId]
      );

      if (productResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: `Product ${item.productId} not found` });
      }

      const product = productResult.rows[0];
      if (product.stock < item.quantity) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Insufficient stock for "${product.name}" (available: ${product.stock}, requested: ${item.quantity})` });
      }

      totalAmount += product.price * item.quantity;
      resolvedItems.push({
        productId: product.id,
        productName: product.name,
        quantity: item.quantity,
        unitPrice: product.price
      });
    }

    // Insert order
    const orderResult = await client.query(
      'INSERT INTO orders (user_id, total_amount, status) VALUES ($1, $2, $3) RETURNING *',
      [userId, totalAmount, 'pending']
    );
    const order = orderResult.rows[0];

    // Insert order items and decrement stock
    for (const item of resolvedItems) {
      await client.query(
        'INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES ($1, $2, $3, $4)',
        [order.id, item.productId, item.quantity, item.unitPrice]
      );
      await client.query(
        'UPDATE products SET stock = stock - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [item.quantity, item.productId]
      );
    }

    await client.query('COMMIT');
    ordersCreated.inc();

    // Publish to RabbitMQ
    if (channel) {
      try {
        channel.publish(
          'orders',
          'order.created',
          Buffer.from(JSON.stringify({
            orderId: order.id,
            userId,
            totalAmount,
            items: resolvedItems
          })),
          { persistent: true }
        );
      } catch (err) {
        console.error('RabbitMQ publish error:', err.message);
      }
    }

    res.status(201).json({ ...order, items: resolvedItems });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    res.status(500).json({ error: 'Failed to create order' });
  } finally {
    client.release();
  }
});

// Get all orders
app.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const result = await pool.query(
      'SELECT * FROM orders ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );
    res.json({ orders: result.rows, pagination: { page, limit } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// Get order by ID (with items)
app.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid order ID' });
    }

    const orderResult = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const itemsResult = await pool.query(
      `SELECT oi.*, p.name as product_name
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = $1`,
      [id]
    );

    res.json({ ...orderResult.rows[0], items: itemsResult.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

// Update order status
app.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled', 'failed'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${validStatuses.join(', ')}` });
    }

    const result = await pool.query(
      'UPDATE orders SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      [status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Publish status change event
    if (channel) {
      try {
        channel.publish(
          'orders',
          `order.${status}`,
          Buffer.from(JSON.stringify({ orderId: parseInt(id), status })),
          { persistent: true }
        );
      } catch (err) {
        console.error('RabbitMQ publish error:', err.message);
      }
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update order' });
  }
});

// Get user orders
app.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    if (isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    const result = await pool.query(
      'SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );
    res.json({ orders: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Order Service listening on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  server.close(async () => {
    await pool.end();
    if (channel) await channel.close().catch(() => {});
    if (rabbitConnection) await rabbitConnection.close().catch(() => {});
    process.exit(0);
  });
});

module.exports = app;
