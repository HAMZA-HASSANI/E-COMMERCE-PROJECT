const express = require('express');
const { Pool } = require('pg');
const amqp = require('amqplib');
const axios = require('axios');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3003;

// Database connection
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  host: process.env.DB_HOST || 'postgres',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'ecommerce'
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());

// RabbitMQ connection
let channel;
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@rabbitmq:5672';

async function connectRabbitMQ() {
  try {
    const connection = await amqp.connect(RABBITMQ_URL);
    channel = await connection.createChannel();
    await channel.assertExchange('orders', 'topic', { durable: true });
    console.log('Connected to RabbitMQ');
  } catch (err) {
    console.error('RabbitMQ connection failed:', err);
    setTimeout(connectRabbitMQ, 5000);
  }
}

connectRabbitMQ();

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ status: 'Order Service is running', timestamp: result.rows[0].now });
  } catch (err) {
    res.status(500).json({ error: 'Database connection failed' });
  }
});

// Create order
app.post('/', async (req, res) => {
  try {
    const { userId, items } = req.body;
    
    // Calculate total amount from items
    let totalAmount = 0;
    if (items && Array.isArray(items)) {
      for (const item of items) {
        const productResult = await pool.query(
          'SELECT price FROM products WHERE id = $1',
          [item.productId]
        );
        if (productResult.rows.length > 0) {
          totalAmount += productResult.rows[0].price * item.quantity;
        }
      }
    }
    
    const result = await pool.query(
      'INSERT INTO orders (user_id, total_amount, status) VALUES ($1, $2, $3) RETURNING *',
      [userId, totalAmount, 'pending']
    );
    
    const order = result.rows[0];

    // Publish to RabbitMQ
    if (channel) {
      await channel.publish(
        'orders',
        'order.created',
        Buffer.from(JSON.stringify({ orderId: order.id, userId, totalAmount, items }))
      );
    }
    
    res.status(201).json(order);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// Get order by ID
app.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

// Get user orders
app.get('/user/:userId', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM orders WHERE user_id = $1', [req.params.userId]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Order Service listening on port ${PORT}`);
});
