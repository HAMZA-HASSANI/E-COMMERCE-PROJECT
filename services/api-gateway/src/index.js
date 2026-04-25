const express = require('express');
const httpProxy = require('express-http-proxy');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'API Gateway is running', timestamp: new Date() });
});

// Service discovery
const PRODUCT_SERVICE = process.env.PRODUCT_SERVICE_URL || 'http://product-service:3001';
const USER_SERVICE = process.env.USER_SERVICE_URL || 'http://user-service:3002';
const ORDER_SERVICE = process.env.ORDER_SERVICE_URL || 'http://order-service:3003';

// Routes to services
app.use('/api/products', httpProxy(PRODUCT_SERVICE));
app.use('/api/users', httpProxy(USER_SERVICE));
app.use('/api/orders', httpProxy(ORDER_SERVICE));

// Root endpoint
app.get('/api', (req, res) => {
  res.json({
    message: 'E-commerce API Gateway',
    version: '1.0.0',
    services: {
      products: '/api/products',
      users: '/api/users',
      orders: '/api/orders'
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`API Gateway listening on port ${PORT}`);
});
