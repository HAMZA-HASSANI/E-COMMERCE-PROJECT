# Architecture E-Commerce Platform

## 📐 Schéma Global de la Plateforme

```mermaid
graph TB
    subgraph "Clients"
        WebUI["🌐 Web Browser"]
        Mobile["📱 Mobile App"]
        Admin["👨‍💼 Admin Dashboard"]
    end

    subgraph "API Layer"
        Gateway["🚪 API Gateway<br/>Port 3000<br/>Express.js + Helmet"]
    end

    subgraph "Microservices"
        UserSvc["👤 User Service<br/>Port 3002<br/>Authentication<br/>User Profiles"]
        ProductSvc["📦 Product Service<br/>Port 3001<br/>Product Catalog<br/>Inventory"]
        OrderSvc["🛒 Order Service<br/>Port 3003<br/>Order Management<br/>Order Processing"]
        NotifSvc["📧 Notification Service<br/>Port 3004<br/>Email Notifications<br/>Event Consumer"]
    end

    subgraph "Data Persistence"
        PostgreSQL["🐘 PostgreSQL 15<br/>Port 5432<br/>- users<br/>- products<br/>- orders"]
        Redis["⚡ Redis 7<br/>Port 6379<br/>Caching Layer<br/>Session Storage"]
    end

    subgraph "Message Queue"
        RabbitMQ["🐰 RabbitMQ 3<br/>Port 5672<br/>Message Broker<br/>Async Communication"]
        Exchange["Topic Exchange<br/>orders.topic"]
    end

    subgraph "External Services"
        MailHog["📮 MailHog<br/>Port 8025<br/>Email Testing"]
    end

    subgraph "Monitoring & Logs"
        Logs["📋 Logs Stream<br/>Docker Compose"]
    end

    WebUI -->|HTTP/REST| Gateway
    Mobile -->|HTTP/REST| Gateway
    Admin -->|HTTP/REST| Gateway

    Gateway -->|Routes| UserSvc
    Gateway -->|Routes| ProductSvc
    Gateway -->|Routes| OrderSvc

    UserSvc -->|Read/Write| PostgreSQL
    UserSvc -->|Cache| Redis
    ProductSvc -->|Read/Write| PostgreSQL
    ProductSvc -->|Cache| Redis
    OrderSvc -->|Read/Write| PostgreSQL
    OrderSvc -->|Publish Event| Exchange

    Exchange -->|Subscribe| NotifSvc
    NotifSvc -->|Send Email| MailHog
    NotifSvc -->|Read| PostgreSQL

    PostgreSQL -->|Logs| Logs
    OrderSvc -->|Logs| Logs
    NotifSvc -->|Logs| Logs
    UserSvc -->|Logs| Logs
    ProductSvc -->|Logs| Logs
```

---

## 🌐 Plan d'Adressage (IP & Ports)

### Services Internes (Docker Compose Network)
| Service | Host Internal | Port | Protocole | Utilisation |
|---------|---------------|------|-----------|-------------|
| **API Gateway** | api-gateway | 3000 | HTTP/REST | Point d'entrée public |
| **Product Service** | product-service | 3001 | HTTP/REST | Catalogue produits |
| **User Service** | user-service | 3002 | HTTP/REST | Authentification |
| **Order Service** | order-service | 3003 | HTTP/REST | Gestion commandes |
| **Notification Service** | notification-service | 3004 | HTTP/REST | Notifications |
| **PostgreSQL** | postgres | 5432 | TCP | Base de données |
| **Redis** | redis | 6379 | TCP | Cache/Session |
| **RabbitMQ** | rabbitmq | 5672 | AMQP | Message broker |
| **RabbitMQ Management** | rabbitmq | 15672 | HTTP | Interface de gestion |

### Accès Local (Docker Host: localhost)
| Service | Protocole | URL/Port | Accès Public |
|---------|-----------|----------|--------------|
| **API Gateway** | HTTP | http://localhost:3000 | ✅ Oui |
| **RabbitMQ Management** | HTTP | http://localhost:15672 | ✅ Oui |
| **MailHog Web** | HTTP | http://localhost:8025 | ✅ Oui |
| **PostgreSQL** | TCP | localhost:5432 | ✅ Oui (avec credentials) |
| **Redis** | TCP | localhost:6379 | ✅ Oui |
| **RabbitMQ AMQP** | TCP | localhost:5672 | ✅ Oui |

---

## 🔌 Endpoints de l'API Gateway

```
API Gateway: http://localhost:3000

├── GET  /health
│   └── Status health check
│
├── GET  /api
│   └── Liste des services disponibles
│
├── /api/products
│   ├── GET    /                   → Lister tous les produits
│   ├── GET    /:id                → Détail d'un produit
│   ├── POST   /                   → Créer un produit
│   └── PUT    /:id                → Modifier un produit
│
├── /api/users
│   ├── GET    /                   → Lister les utilisateurs
│   ├── GET    /:id                → Détail utilisateur
│   ├── POST   /register           → Créer un compte
│   └── POST   /login              → Authentification
│
└── /api/orders
    ├── GET    /                   → Lister les commandes
    ├── GET    /:id                → Détail d'une commande
    ├── POST   /                   → Créer une commande
    └── GET    /user/:userId       → Commandes d'un utilisateur
```

---

## 📦 Architecture des Données

### Tables PostgreSQL

```
┌─────────────────────────────────────┐
│         USERS TABLE                 │
├─────────────────────────────────────┤
│ id (PK)                             │
│ email (UNIQUE)                      │
│ password_hash                       │
│ name                                │
│ created_at, updated_at              │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│       PRODUCTS TABLE                │
├─────────────────────────────────────┤
│ id (PK)                             │
│ name                                │
│ description                         │
│ price                               │
│ stock                               │
│ created_at, updated_at              │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│        ORDERS TABLE                 │
├─────────────────────────────────────┤
│ id (PK)                             │
│ user_id (FK → users)                │
│ total_amount                        │
│ status (pending/completed/failed)   │
│ created_at, updated_at              │
└─────────────────────────────────────┘
```

---

## 🔄 Flux de Communication Asynchrone

### Event: Order Created

```
┌──────────────────────────────────────────────────────────────┐
│ 1. Client crée une commande                                  │
│    POST /api/orders {userId, items}                          │
└─────────────────────────────┬────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ 2. Order Service traite la demande                           │
│    - Calcule le montant total                                │
│    - Insère en base de données (PostgreSQL)                  │
│    - Publie l'événement "order.created"                      │
└─────────────────────────────┬────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ 3. RabbitMQ reçoit et route l'événement                      │
│    Exchange: orders (topic)                                  │
│    Routing key: order.created                                │
└─────────────────────────────┬────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ 4. Notification Service consomme l'événement                 │
│    - Récupère les détails de la commande                     │
│    - Récupère les infos de l'utilisateur                     │
│    - Compose l'email                                         │
│    - Envoie via MailHog                                      │
└──────────────────────────────────────────────────────────────┘
```

---

## 🛡️ Stack Technologique Détaillé

### Backend
- **Runtime**: Node.js 18
- **Framework**: Express.js 4.18
- **Sécurité**: Helmet.js (HTTP headers)
- **CORS**: Enabled
- **Logging**: Morgan
- **Environment**: dotenv

### Base de Données
- **Principal**: PostgreSQL 15 (Alpine)
- **Cache**: Redis 7 (Alpine)
- **Protocol**: TCP

### Message Queue
- **Broker**: RabbitMQ 3 (Alpine)
- **Protocol**: AMQP
- **Pattern**: Topic Exchange (asynchrone, découplé)

### Containerization
- **Docker**: Version 20+
- **Docker Compose**: v3.8+
- **Images**: Alpine Linux (léger, sécurisé)
- **Multi-stage builds**: Optimisés pour production

### Testing & Development
- **Email**: MailHog (capture SMTP)
- **Health Checks**: HTTP endpoints
- **Logs**: Docker Compose logs

---

## ⚙️ Variables d'Environnement

```env
# Database
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=ecommerce
DB_HOST=postgres
DB_PORT=5432

# RabbitMQ
RABBITMQ_USER=guest
RABBITMQ_PASSWORD=guest
RABBITMQ_URL=amqp://guest:guest@rabbitmq:5672

# Services
PORT=3000  # for each service
NODE_ENV=production

# API Gateway URLs (internal Docker network)
PRODUCT_SERVICE_URL=http://product-service:3001
USER_SERVICE_URL=http://user-service:3002
ORDER_SERVICE_URL=http://order-service:3003
```

---

## 📊 Caractéristiques de Déploiement

### Development (Docker Compose)
✅ Single node deployment  
✅ Développement local facile  
✅ Health checks automatiques  
✅ Volumes persistants pour données  

### Production (Kubernetes)
✅ Multi-node scaling  
✅ Load balancing  
✅ Secrets management  
✅ Resource limits  
✅ Liveness & Readiness probes  

---

## 🔐 Considérations Sécurité

- **Helmet.js**: Protection headers HTTP
- **CORS**: Contrôle des origines
- **JWT** (à implémenter): Authentification stateless
- **Secrets**: Gérés via environment variables
- **Health Checks**: Détection des services défaillants
- **Images Alpine**: Surface d'attaque réduite

