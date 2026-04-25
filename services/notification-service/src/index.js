const amqp = require('amqplib');
const nodemailer = require('nodemailer');
require('dotenv').config();

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@rabbitmq:5672';

// Configure email transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'localhost',
  port: process.env.SMTP_PORT || 1025,
  secure: false,
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASSWORD || ''
  }
});

async function start() {
  try {
    const connection = await amqp.connect(RABBITMQ_URL);
    const channel = await connection.createChannel();

    // Assert exchange and queue
    await channel.assertExchange('orders', 'topic', { durable: true });
    const queue = await channel.assertQueue('notification_queue', { durable: true });
    await channel.bindQueue(queue.queue, 'orders', 'order.created');

    console.log('Notification Service started, waiting for messages...');

    // Consume messages
    channel.consume(queue.queue, async (msg) => {
      if (msg) {
        try {
          const order = JSON.parse(msg.content.toString());
          console.log('Received order:', order);

          // Send notification email
          await transporter.sendMail({
            from: 'noreply@ecommerce.local',
            to: 'user@example.com',
            subject: `Order #${order.orderId} Confirmation`,
            html: `<h1>Order Confirmed</h1><p>Your order has been created with ID: ${order.orderId}</p>`
          });

          console.log('Notification sent for order:', order.orderId);
          channel.ack(msg);
        } catch (err) {
          console.error('Error processing message:', err);
          channel.nack(msg);
        }
      }
    });

    // Handle connection close
    connection.on('close', () => {
      console.log('Connection closed');
      setTimeout(start, 5000);
    });
  } catch (err) {
    console.error('Connection failed:', err);
    setTimeout(start, 5000);
  }
}

start();
