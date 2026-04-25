# E-Commerce DevOps Learning Platform

A complete containerized e-commerce platform designed to teach Docker and Kubernetes best practices.

## 🎯 Project Overview

This project is a production-ready e-commerce platform built with Node.js microservices, PostgreSQL, Redis, and RabbitMQ. It demonstrates:

- **Microservices Architecture**: Independent, scalable services
- **Containerization**: Multi-stage Docker builds with health checks
- **Orchestration**: Kubernetes manifests with best practices
- **DevOps Patterns**: Configuration management, secrets, monitoring, graceful shutdown
- **Message-Driven Design**: Async communication via RabbitMQ
- **Data Persistence**: PostgreSQL with migrations, Redis caching
- **Security**: JWT authentication, secrets management

## 📁 Project Structure

```
ecommerce-platform/
├── services/                    # Microservices
│   ├── api-gateway/            # Request router
│   ├── product-service/        # Product management
│   ├── user-service/           # User authentication
│   ├── order-service/          # Order management
│   └── notification-service/   # Email notifications
├── kubernetes/                 # K8s manifests
│   ├── 00-namespace-config.yaml
│   ├── 01-postgres.yaml
│   ├── 02-redis.yaml
│   ├── 03-rabbitmq.yaml
│   ├── 04-microservices.yaml
│   ├── 05-api-gateway.yaml
│   └── 06-notification-services.yaml
├── database/                   # Database scripts
│   └── init.sql
├── scripts/                    # Utility scripts
│   ├── build-docker-images.sh
│   ├── start-docker-compose.sh
│   ├── deploy-kubernetes.sh
│   ├── cleanup-kubernetes.sh
│   └── stop-docker-compose.sh
├── docker-compose.yml          # Local development
├── .env.example                # Environment template
└── README.md                   # This file
```

## 🚀 Getting Started

### Prerequisites

- Docker & Docker Compose (for local development)
- Minikube (for Kubernetes learning)
- kubectl CLI
- Node.js 18+ (for development)

### Option 1: Docker Compose (Local Development)

**Quick start:**

```bash
# Copy environment file
cp .env.example .env

# Start all services
docker-compose up -d

# Check services
docker-compose ps

# View logs
docker-compose logs -f api-gateway
```

**Service URLs:**
- API Gateway: http://localhost:3000
- RabbitMQ UI: http://localhost:15672 (guest/guest)
- MailHog: http://localhost:8025
- PostgreSQL: localhost:5432

### Option 2: Kubernetes (Learning & Production-like)

**Setup Kubernetes cluster:**

```bash
# Start Minikube
minikube start --cpus=4 --memory=8192

# Build and deploy
./scripts/deploy-kubernetes.sh

# Check status
kubectl get all -n ecommerce

# Port forward to API Gateway
kubectl port-forward svc/api-gateway 3000:3000 -n ecommerce
```

**Cleanup:**

```bash
./scripts/cleanup-kubernetes.sh
minikube stop
```

## 🏗️ Architecture

### Services

| Service | Port | Purpose |
|---------|------|---------|
| API Gateway | 3000 | Request routing & service discovery |
| Product Service | 3001 | Product catalog management |
| User Service | 3002 | User auth & profiles |
| Order Service | 3003 | Order processing |
| Notification Service | - | Email notifications (async) |

### Infrastructure

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Database | PostgreSQL 15 | Data persistence |
| Cache | Redis 7 | Session & cache storage |
| Message Broker | RabbitMQ 3 | Async event processing |
| Email Testing | MailHog | Development email capture |

## 📊 DevOps Features Implemented

### Docker Best Practices
- ✅ Multi-stage builds for smaller images
- ✅ Health checks for all services
- ✅ Proper signal handling (SIGTERM/SIGKILL)
- ✅ Non-root user execution
- ✅ Resource limits and requests
- ✅ Optimized layers (node_modules caching)

### Kubernetes Best Practices
- ✅ Namespace isolation
- ✅ ConfigMaps for configuration
- ✅ Secrets for sensitive data
- ✅ Liveness and readiness probes
- ✅ Resource requests and limits
- ✅ RollingUpdate strategy
- ✅ Graceful shutdown (preStop hooks)
- ✅ PersistentVolumeClaims for data
- ✅ Service discovery via DNS
- ✅ Ingress for external access

### Application Patterns
- ✅ Service discovery (DNS-based)
- ✅ Health checks
- ✅ Graceful degradation
- ✅ Async event processing
- ✅ JWT authentication
- ✅ Environment-based configuration

## 🔌 API Endpoints

### API Gateway (Port 3000)

```bash
# Health check
GET /health

# Service discovery
GET /api

# Product endpoints
GET /api/products/
GET /api/products/:id
POST /api/products/

# User endpoints
POST /api/users/register
POST /api/users/login
GET /api/users/:id

# Order endpoints
POST /api/orders/
GET /api/orders/:id
GET /api/orders/user/:userId
```

## 🔄 Message Flow

1. **Order Creation**
   - Client calls `/api/orders/`
   - Order Service creates order in DB
   - Order Service publishes `order.created` to RabbitMQ
   - Notification Service consumes event
   - Email notification sent via MailHog

## 🛠️ Development Tips

### Building Images Locally

```bash
./scripts/build-docker-images.sh
```

### Viewing Service Logs

Docker Compose:
```bash
docker-compose logs -f service-name
```

Kubernetes:
```bash
kubectl logs -f deployment/product-service -n ecommerce
```

### Scaling Services

Kubernetes:
```bash
kubectl scale deployment product-service --replicas=3 -n ecommerce
```

### Database Access

```bash
# Using docker-compose
docker-compose exec postgres psql -U postgres -d ecommerce

# Using kubectl
kubectl exec -it deployment/postgres -n ecommerce -- psql -U postgres -d ecommerce
```

## 📚 Learning Path

### Week 1: Docker Fundamentals
- [ ] Understand each Dockerfile
- [ ] Build images manually
- [ ] Run containers individually
- [ ] Learn about layers and caching

### Week 2: Docker Compose
- [ ] Run full stack with docker-compose
- [ ] Practice networking between services
- [ ] Configure volumes and persistence
- [ ] Environment management

### Week 3: Kubernetes Basics
- [ ] Deploy single service
- [ ] Create ConfigMaps and Secrets
- [ ] Practice port forwarding
- [ ] Scale deployments

### Week 4: Kubernetes Advanced
- [ ] Health checks (liveness/readiness)
- [ ] Resource management
- [ ] Rolling updates
- [ ] Persistent volumes

### Week 5: Production Patterns
- [ ] Monitoring with Prometheus
- [ ] Logging aggregation
- [ ] CI/CD integration
- [ ] Security practices

## 🐛 Troubleshooting

### Services not communicating
- Check DNS resolution: `docker-compose exec api-gateway getent hosts product-service`
- Verify network: `docker network ls`
- Check service status: `docker-compose ps`

### Database connection failed
- Ensure postgres is healthy: `docker-compose exec postgres pg_isready`
- Check credentials in .env
- Verify init.sql ran: `docker-compose logs postgres`

### RabbitMQ issues
- Check Management UI: http://localhost:15672
- Verify connections: `rabbitmqctl list_connections`
- Check queue bindings: `rabbitmqctl list_bindings`

### Kubernetes pod pending
- Check events: `kubectl describe pod pod-name -n ecommerce`
- Check resource availability: `kubectl top nodes`
- Check PVC status: `kubectl get pvc -n ecommerce`

## 📖 Additional Resources

- [Docker Documentation](https://docs.docker.com/)
- [Kubernetes Documentation](https://kubernetes.io/docs/)
- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices)
- [PostgreSQL Docker Guide](https://hub.docker.com/_/postgres)
- [12-Factor App Methodology](https://12factor.net/)

## 🎓 Lessons Learned

This project teaches:

1. **Container Design**: Multi-stage builds, layer optimization
2. **Networking**: Service discovery, DNS, port mapping
3. **Data Management**: Persistence, migrations, backups
4. **Resilience**: Health checks, restart policies, load balancing
5. **Operations**: Logs, monitoring, debugging
6. **Security**: Secrets, authentication, network policies
7. **Scaling**: Horizontal scaling, resource management
8. **CI/CD**: Automation, deployment strategies

## 📝 License

This project is for educational purposes.

---

**Happy learning! 🚀**
