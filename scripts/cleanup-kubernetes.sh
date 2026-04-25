#!/bin/bash

echo "🗑️ Cleaning up Kubernetes cluster..."
kubectl delete namespace ecommerce --ignore-not-found=true

echo "⏳ Waiting for namespace to be deleted..."
sleep 5

echo "✅ Kubernetes cluster cleaned up!"
