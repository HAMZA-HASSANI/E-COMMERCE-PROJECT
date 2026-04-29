const express = require('express');
const amqp = require('amqplib');
const nodemailer = require('nodemailer');
const { Pool } = require('pg');
const promClient = require('prom-client');
require('dotenv').config();

const HEALTH_PORT = process.env.HEALTH_PORT || 3004;

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@rabbitmq:5672';

// Database connection to fetch real user info
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  host: process.env.DB_HOST || 'postgres',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'ecommerce',
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Configure email transporter (auth only when credentials are provided — MailHog needs none)
const smtpOptions = {
  host: process.env.SMTP_HOST || 'localhost',
  port: parseInt(process.env.SMTP_PORT || '1025', 10),
  secure: false,
  ignoreTLS: true
};
if (process.env.SMTP_USER && process.env.SMTP_PASSWORD) {
  smtpOptions.auth = {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD
  };
}
const transporter = nodemailer.createTransport(smtpOptions);

// Email templates
function orderCreatedEmail(user, order) {
  const itemsHtml = (order.items || []).map(item =>
    `<tr>
      <td style="padding:8px;border-bottom:1px solid #eee;">${item.productName || `Product #${item.productId}`}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:center;">${item.quantity}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">$${Number(item.unitPrice).toFixed(2)}</td>
    </tr>`
  ).join('');

  return {
    subject: `Order #${order.orderId} — Confirmation`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;background:#f9f9f9;padding:30px;border-radius:10px;">
        <h1 style="color:#6366f1;">Order Confirmed ✓</h1>
        <p>Hello <strong>${user.name || user.email}</strong>,</p>
        <p>Your order <strong>#${order.orderId}</strong> has been received and is being processed.</p>
        <table style="width:100%;border-collapse:collapse;margin:20px 0;">
          <thead>
            <tr style="background:#6366f1;color:white;">
              <th style="padding:10px;text-align:left;">Product</th>
              <th style="padding:10px;text-align:center;">Qty</th>
              <th style="padding:10px;text-align:right;">Price</th>
            </tr>
          </thead>
          <tbody>${itemsHtml}</tbody>
        </table>
        <p style="font-size:18px;font-weight:bold;">Total: $${Number(order.totalAmount).toFixed(2)}</p>
        <hr style="border:none;border-top:1px solid #ddd;margin:20px 0;">
        <p style="color:#888;font-size:12px;">E-Commerce Platform — This is an automated message.</p>
      </div>
    `
  };
}

function orderStatusEmail(user, data) {
  const statusMessages = {
    confirmed: { emoji: '✅', text: 'has been confirmed and is being prepared.' },
    shipped: { emoji: '🚚', text: 'has been shipped! It\'s on its way to you.' },
    delivered: { emoji: '📦', text: 'has been delivered. Enjoy your purchase!' },
    cancelled: { emoji: '❌', text: 'has been cancelled.' },
    failed: { emoji: '⚠️', text: 'could not be processed. Please contact support.' },
  };

  const info = statusMessages[data.status] || { emoji: 'ℹ️', text: `status has been updated to "${data.status}".` };

  return {
    subject: `Order #${data.orderId} — ${data.status.charAt(0).toUpperCase() + data.status.slice(1)}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;background:#f9f9f9;padding:30px;border-radius:10px;">
        <h1 style="color:#6366f1;">${info.emoji} Order Update</h1>
        <p>Hello <strong>${user.name || user.email}</strong>,</p>
        <p>Your order <strong>#${data.orderId}</strong> ${info.text}</p>
        <hr style="border:none;border-top:1px solid #ddd;margin:20px 0;">
        <p style="color:#888;font-size:12px;">E-Commerce Platform — This is an automated message.</p>
      </div>
    `
  };
}

// Fetch the real user email from the database
async function getUserById(userId) {
  try {
    const result = await pool.query('SELECT id, email, name FROM users WHERE id = $1', [userId]);
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (err) {
    console.error('Failed to fetch user:', err.message);
    return null;
  }
}

async function start() {
  try {
    const connection = await amqp.connect(RABBITMQ_URL);
    const channel = await connection.createChannel();

    // Assert exchange and queue
    await channel.assertExchange('orders', 'topic', { durable: true });
    const queue = await channel.assertQueue('notification_queue', { durable: true });

    // Bind to all order events (order.created, order.confirmed, order.shipped, etc.)
    await channel.bindQueue(queue.queue, 'orders', 'order.*');

    // Set prefetch to 1 to process one message at a time
    await channel.prefetch(1);

    console.log('Notification Service started, waiting for messages...');

    // Consume messages
    channel.consume(queue.queue, async (msg) => {
      if (!msg) return;
      const routingKey = msg.fields.routingKey || 'unknown';
      try {
        const data = JSON.parse(msg.content.toString());
        console.log(`Received event [${routingKey}]:`, data);

        // Fetch real user from database
        const user = await getUserById(data.userId);
        if (!user) {
          console.error(`User ${data.userId} not found, cannot send notification`);
          notificationsFailed.inc({ event_type: routingKey });
          channel.ack(msg); // Ack to avoid infinite retry
          return;
        }

        // Build email based on event type
        let emailContent;
        if (routingKey === 'order.created') {
          emailContent = orderCreatedEmail(user, data);
        } else {
          emailContent = orderStatusEmail(user, data);
        }

        // Send notification email to the REAL user email
        await transporter.sendMail({
          from: '"E-Commerce Platform" <noreply@ecommerce.local>',
          to: user.email,
          subject: emailContent.subject,
          html: emailContent.html
        });

        console.log(`Email sent to ${user.email} for event [${routingKey}], order #${data.orderId}`);
        notificationsSent.inc({ event_type: routingKey });
        channel.ack(msg);
      } catch (err) {
        console.error('Error processing message:', err.message);
        notificationsFailed.inc({ event_type: routingKey });
        // Reject and requeue (will go to DLQ after max retries if configured)
        channel.nack(msg, false, false);
      }
    });

    // Handle connection close
    connection.on('close', () => {
      console.log('RabbitMQ connection closed, reconnecting...');
      setTimeout(start, 5000);
    });
  } catch (err) {
    console.error('Connection failed:', err.message);
    setTimeout(start, 5000);
  }
}

// ─── PROMETHEUS METRICS ─────────────────────────────────────────────────────────────
const collectDefaultMetrics = promClient.collectDefaultMetrics;
collectDefaultMetrics({ prefix: 'notification_service_' });

const notificationsSent = new promClient.Counter({
  name: 'notification_service_emails_sent_total',
  help: 'Total number of notification emails sent',
  labelNames: ['event_type']
});

const notificationsFailed = new promClient.Counter({
  name: 'notification_service_emails_failed_total',
  help: 'Total number of failed notification emails',
  labelNames: ['event_type']
});

// ─── HEALTH & METRICS HTTP SERVER ───────────────────────────────────────────────
const healthApp = express();
let isConnected = false;

healthApp.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'Notification Service is running', connected: isConnected, postgres: true });
  } catch (err) {
    res.status(500).json({ status: 'unhealthy', error: err.message });
  }
});

healthApp.get('/metrics', async (req, res) => {
  res.set('Content-Type', promClient.register.contentType);
  res.end(await promClient.register.metrics());
});

healthApp.listen(HEALTH_PORT, '0.0.0.0', () => {
  console.log(`Notification health/metrics server on port ${HEALTH_PORT}`);
});

start();

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  await pool.end();
  process.exit(0);
});
