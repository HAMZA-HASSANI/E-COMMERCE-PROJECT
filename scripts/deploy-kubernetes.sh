#!/bin/bash
set -e

echo "🎯 Building images..."
./scripts/build-docker-images.sh

echo ""
echo "🔧 Setting up Kubernetes cluster..."
minikube start --cpus=4 --memory=8192

echo ""
echo "🏗️ Building images in Minikube..."
eval $(minikube docker-env)
./scripts/build-docker-images.sh

echo ""
echo "📦 Deploying to Kubernetes..."
kubectl apply -f kubernetes/

echo ""
echo "⏳ Waiting for deployments to be ready..."
kubectl wait --for=condition=available --timeout=300s deployment --all -n ecommerce

echo ""
echo "✅ Kubernetes deployment complete!"
echo ""
echo "📊 Get services:"
kubectl get svc -n ecommerce
echo ""
echo "📋 Get pods:"
kubectl get pods -n ecommerce
echo ""
echo "🌐 Port forwarding to API Gateway:"
echo "  kubectl port-forward svc/api-gateway 3000:3000 -n ecommerce"
