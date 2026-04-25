#!/bin/bash
set -e

echo "🚀 Building Docker images..."

docker build -t ecommerce-api-gateway:latest ./services/api-gateway
docker build -t ecommerce-product-service:latest ./services/product-service
docker build -t ecommerce-user-service:latest ./services/user-service
docker build -t ecommerce-order-service:latest ./services/order-service
docker build -t ecommerce-notification-service:latest ./services/notification-service

echo "✅ All images built successfully!"
docker images | grep ecommerce
