#!/bin/bash
set -e

echo "📦 Creating .env file from .env.example..."
cp .env.example .env

echo "🐳 Starting Docker Compose..."
docker-compose up -d

echo "⏳ Waiting for services to be ready..."
sleep 10

echo "✅ All services started!"
echo ""
echo "📊 Service URLs:"
echo "  API Gateway: http://localhost:3000"
echo "  Product Service: http://localhost:3001"
echo "  User Service: http://localhost:3002"
echo "  Order Service: http://localhost:3003"
echo "  RabbitMQ Management: http://localhost:15672 (guest/guest)"
echo "  PostgreSQL: localhost:5432"
echo "  Redis: localhost:6379"
echo "  MailHog: http://localhost:8025"
echo ""
echo "🔍 Check services:"
echo "  docker-compose ps"
echo ""
echo "📋 View logs:"
echo "  docker-compose logs -f api-gateway"
