# Quick Reference Guide for E-Commerce DevOps Platform

## 🚀 Quick Start Commands

### Docker Compose
```bash
# Start all services
docker-compose up -d

# Stop services
docker-compose down

# View logs
docker-compose logs -f

# Restart a service
docker-compose restart product-service
```

### Kubernetes
```bash
# Start Minikube
minikube start --cpus=4 --memory=8192

# Deploy
kubectl apply -f kubernetes/

# Check status
kubectl get all -n ecommerce

# Port forwarding
kubectl port-forward svc/api-gateway 3000:3000 -n ecommerce
```

## 📊 Service Health

### Check health endpoints
```bash
curl http://localhost:3000/health    # API Gateway
curl http://localhost:3001/health    # Product Service
curl http://localhost:3002/health    # User Service
curl http://localhost:3003/health    # Order Service
```

## 🔍 Debugging

### View logs
```bash
# Docker Compose
docker-compose logs service-name

# Kubernetes
kubectl logs deployment/product-service -n ecommerce
kubectl logs -f deployment/product-service -n ecommerce
```

### Access database
```bash
# Docker Compose
docker-compose exec postgres psql -U postgres -d ecommerce

# Kubernetes
kubectl exec -it deployment/postgres -n ecommerce -- psql -U postgres -d ecommerce
```

### Access RabbitMQ Management
- URL: http://localhost:15672
- Username: guest
- Password: guest

### Access MailHog
- URL: http://localhost:8025

## 📈 Scaling

### With Docker Compose
```bash
# Scale a service
docker-compose up -d --scale product-service=3
```

### With Kubernetes
```bash
# Scale deployment
kubectl scale deployment product-service --replicas=3 -n ecommerce
```

## 🔐 Secrets Management

### View secrets
```bash
kubectl get secrets -n ecommerce
kubectl describe secret ecommerce-secret -n ecommerce
```

### Update secret
```bash
kubectl create secret generic ecommerce-secret \
  --from-literal=DB_PASSWORD=newpassword \
  --dry-run=client -o yaml | kubectl apply -f -
```

## 📦 Building Images

### Build all images
```bash
./scripts/build-docker-images.sh
```

### Build single image
```bash
docker build -t ecommerce-product-service:latest ./services/product-service
```

## 🔄 Database Migrations

### View tables
```sql
\dt
```

### Check constraints
```sql
\d products
```

## 🎯 Testing Endpoints

### Register user
```bash
curl -X POST http://localhost:3000/api/users/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123","name":"Test User"}'
```

### Get products
```bash
curl http://localhost:3000/api/products/
```

### Create order
```bash
curl -X POST http://localhost:3000/api/orders/ \
  -H "Content-Type: application/json" \
  -d '{"userId":1,"items":[{"productId":1,"quantity":2}],"totalAmount":1999.98}'
```

## 🛠️ Troubleshooting

### Container won't start
```bash
docker-compose logs service-name
docker inspect container-name
```

### Pod won't start
```bash
kubectl describe pod pod-name -n ecommerce
kubectl logs pod-name -n ecommerce
```

### Network issues
```bash
# Docker
docker network ls
docker network inspect ecommerce-network

# Kubernetes
kubectl get svc -n ecommerce
kubectl get endpoints -n ecommerce
```

### Database connection issues
```bash
# Test connection
telnet postgres 5432

# Check logs
docker-compose logs postgres
```

## 📚 Key Files

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Local dev environment |
| `kubernetes/` | K8s manifests |
| `.env.example` | Environment variables template |
| `database/init.sql` | Database initialization |
| `services/*/Dockerfile` | Container definitions |

## ⚙️ Configuration

### Environment Variables
Copy `.env.example` to `.env` and update values as needed.

### Kubernetes Secrets
Edit `kubernetes/00-namespace-config.yaml` to update sensitive data.

### Resource Limits
Edit `kubernetes/04-microservices.yaml` to adjust CPU/memory.

## 📱 API Documentation

### Base URL
- Local: `http://localhost:3000`
- Kubernetes: `http://localhost:3000` (after port-forward)

### Common Headers
```
Content-Type: application/json
```

### Status Codes
- 200: Success
- 201: Created
- 400: Bad Request
- 401: Unauthorized
- 404: Not Found
- 500: Server Error

---

**For more details, see README.md**
