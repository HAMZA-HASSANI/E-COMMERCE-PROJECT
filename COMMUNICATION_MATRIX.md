# Communication Matrix - E-Commerce Platform

## 📊 Matrice de Flux de Communication

### Legend
- **→** : Communication synchrone (HTTP/REST)
- **⟿** : Communication asynchrone (Message Queue)
- **↔** : Bidirectionnel
- ✅ : Activé
- ❌ : Désactivé
- 🔄 : Polling/Périodique

---

## 1️⃣ Matrice Complète de Communication

```
                   API-GW  Product  User  Order  Notif  PG   Redis  RMQ
API-Gateway          -      ✅→     ✅→   ✅→    ❌     ❌    ❌     ❌
Product-Service      ✅←    -       ❌    ❌     ❌     ✅↔   ✅↔    ❌
User-Service         ✅←    ❌      -     ❌     ❌     ✅↔   ✅↔    ❌
Order-Service        ✅←    ❌      ❌    -      ❌     ✅↔   ✅↔    ✅⟿
Notification-Svc     ❌     ❌      ❌    ❌     -      ✅←   ✅←    ✅⟿
PostgreSQL           ❌     ✅↔    ✅↔   ✅↔    ✅←    -      ❌     ❌
Redis                ❌     ✅↔    ✅↔   ✅↔    ✅←    ❌     -      ❌
RabbitMQ             ❌     ❌      ❌    ✅⟿   ✅⟿   ❌     ❌     -
```

---

## 2️⃣ Détails des Flux de Communication

### A. Communication Synchrone (HTTP/REST)

#### 1. Clients → API Gateway
```
Flux:        Client (HTTP Request)
             ↓
             API Gateway:3000
             ↓
             Parse & Route
             ↓
             Service approprié

Protocole:   HTTP/1.1 + REST
Sécurité:    Helmet.js, CORS, Morgan logging
Timeout:     30s (default Node.js)
Format:      JSON (application/json)
```

#### 2. API Gateway → Microservices
```
API Gateway:3000  →  Product Service:3001
                  →  User Service:3002
                  →  Order Service:3003

Utilise:     express-http-proxy
Routing:     /api/products → product-service:3001
             /api/users    → user-service:3002
             /api/orders   → order-service:3003

Découverte: Docker DNS (service name)
Format:      JSON over HTTP
```

#### 3. Microservices → PostgreSQL
```
User Service:3002      →  PostgreSQL:5432
Product Service:3001   →  PostgreSQL:5432
Order Service:3003     →  PostgreSQL:5432

Pool:        pg (node-postgres)
Driver:      PostgreSQL TCP
Auth:        password based
Queries:     Synchronous (async/await)
```

#### 4. Microservices → Redis
```
User Service:3002      →  Redis:6379
Product Service:3001   →  Redis:6379
Order Service:3003     →  Redis:6379

Utilisation: Cache de données
Pattern:     Key-Value
TTL:         Configurable par service
Driver:      redis-client
```

---

### B. Communication Asynchrone (Message Queue)

#### Order Service → RabbitMQ → Notification Service

```
FLUX DÉTAILLÉ:
┌─────────────────────────────────────────────────────────────┐
│                    1. Event Production                       │
└─────────────────────────────────────────────────────────────┘

Order Service:3003
  ↓
  1. Crée une commande en BD
  2. Construit le message event:
     {
       "orderId": 3,
       "userId": 1,
       "totalAmount": 1299.97,
       "items": [...]
     }
  3. Publie sur RabbitMQ
     Exchange: "orders"
     Type:     "topic"
     RoutingKey: "order.created"
  ↓
RabbitMQ:5672 (AMQP 0-9-1)

┌─────────────────────────────────────────────────────────────┐
│              2. Message Routing & Storage                    │
└─────────────────────────────────────────────────────────────┘

RabbitMQ Topic Exchange: "orders"
  ↓
  Pattern Matching:
  ├─ order.created   (souscrit par Notification Service)
  ├─ order.updated   (potentiel futur)
  └─ order.cancelled (potentiel futur)
  ↓
Queue: "notifications_queue"
  ↓
Persistent: true (survive aux redémarrages)

┌─────────────────────────────────────────────────────────────┐
│              3. Event Consumption                            │
└─────────────────────────────────────────────────────────────┘

Notification Service:3004
  ↓
  1. Consomme message de la queue
  2. Récupère détails complets:
     - Infos utilisateur (PostgreSQL)
     - Infos commande (PostgreSQL)
     - Détails produits (Redis cache)
  3. Compose email HTML
  4. Envoie via SMTP:
     Host: mailhog:1025 (local)
     To:   user@example.com
  ↓
MailHog:1025 (SMTP)
  ↓
UI Web: http://localhost:8025
```

**Caractéristiques:**
- ✅ Découplage complet Order ↔ Notification
- ✅ Retry automatique si erreur
- ✅ Messages persistants
- ✅ Support multi-consumers (scalabilité)
- ✅ Pas de perte de messages (si configured)

---

## 3️⃣ Tableau Récapitulatif des Connexions

### Par Type de Communication

#### Synchrone (Direct HTTP/REST)
| De | Vers | Port | Type | Protocole | Status |
|----|----|------|------|-----------|--------|
| Clients | API Gateway | 3000 | HTTP | REST JSON | ✅ Active |
| API Gateway | Product Service | 3001 | HTTP | REST JSON | ✅ Active |
| API Gateway | User Service | 3002 | HTTP | REST JSON | ✅ Active |
| API Gateway | Order Service | 3003 | HTTP | REST JSON | ✅ Active |
| Product Service | PostgreSQL | 5432 | TCP | PostgreSQL Protocol | ✅ Active |
| User Service | PostgreSQL | 5432 | TCP | PostgreSQL Protocol | ✅ Active |
| Order Service | PostgreSQL | 5432 | TCP | PostgreSQL Protocol | ✅ Active |
| Notification Service | PostgreSQL | 5432 | TCP | PostgreSQL Protocol | ✅ Active |

#### Asynchrone (Message Queue)
| Producteur | Consumer | Broker | Queue | Exchange | Status |
|------------|----------|--------|-------|----------|--------|
| Order Service | Notification Service | RabbitMQ | notifications | orders.topic | ✅ Active |

#### Cache
| Service | Cible | Port | Type | Utilisation | Status |
|---------|-------|------|------|-------------|--------|
| Product Service | Redis | 6379 | TCP | Product Cache | ✅ Active |
| User Service | Redis | 6379 | TCP | User/Session Cache | ✅ Active |
| Order Service | Redis | 6379 | TCP | Order Cache | ✅ Active |

#### Management & Monitoring
| Service | URL | Port | Type | Accès | Status |
|---------|-----|------|------|-------|--------|
| RabbitMQ UI | http://localhost:15672 | 15672 | HTTP | Web Browser | ✅ Active |
| MailHog UI | http://localhost:8025 | 8025 | HTTP | Web Browser | ✅ Active |
| PostgreSQL CLI | localhost:5432 | 5432 | TCP | psql client | ✅ Active |
| Redis CLI | localhost:6379 | 6379 | TCP | redis-cli | ✅ Active |

---

## 4️⃣ Scénarios de Communication Complets

### Scénario 1: Créer une Commande (Order.Create)

```
1. Client Request
   POST http://localhost:3000/api/orders
   Body: { userId: 1, items: [...] }
   ↓
2. API Gateway routing
   Utilise express-http-proxy
   Redirige vers http://order-service:3003/
   ↓
3. Order Service processing
   - Valide les données
   - Calcule total_amount
   - Insère dans PostgreSQL (orders table)
   - Lit les prix des produits
   ↓
4. Order Service → RabbitMQ (Async)
   Publie: {orderId, userId, totalAmount, items}
   Exchange: orders
   RoutingKey: order.created
   ↓
5. Notification Service consomme
   - Récupère l'event
   - Query PostgreSQL (user, order details)
   - Utilise Redis cache si dispo
   - Compose HTML email
   ↓
6. Envoie email via MailHog:1025
   To: user@example.com
   ↓
7. MailHog capture l'email
   Visible via http://localhost:8025
   ↓
8. Réponse Client
   201 Created + {orderId, status, totalAmount, ...}

Temps total:    ~200-500ms
Dépendances:    ✅ PostgreSQL, ✅ RabbitMQ (async)
```

### Scénario 2: Récupérer Liste Produits (Product.List)

```
1. Client Request
   GET http://localhost:3000/api/products
   ↓
2. API Gateway routing
   → http://product-service:3001/
   ↓
3. Product Service processing
   - Vérifie Redis cache (key: "products:all")
   - Si hit: retourne du cache
   - Si miss: 
     * Query PostgreSQL (products table)
     * Stocke en Redis (TTL: 3600s)
     * Retourne
   ↓
4. Réponse Client
   200 OK + [{id, name, price, stock, ...}, ...]
   
Temps total:    ~50-200ms
Dépendances:    ✅ PostgreSQL, ✅ Redis
Cache hit rate: ~80% (après premier appel)
```

### Scénario 3: Authentification Utilisateur (User.Login)

```
1. Client Request
   POST http://localhost:3000/api/users/login
   Body: { email, password }
   ↓
2. API Gateway routing
   → http://user-service:3002/login
   ↓
3. User Service processing
   - Query PostgreSQL: SELECT * FROM users WHERE email = ?
   - Valide password_hash (bcrypt)
   - Si succès:
     * Génère session token
     * Stocke en Redis (key: "session:{token}", TTL: 86400s)
     * Retourne token
   ↓
4. Client stocke token (localStorage/cookie)
   ↓
5. Requêtes futures incluent token en header
   Authorization: Bearer {token}
   ↓
6. API Gateway valide token via User Service

Temps total:    ~150-300ms
Dépendances:    ✅ PostgreSQL, ✅ Redis
```

---

## 5️⃣ Patterns de Communication Utilisés

### 1. Proxy Pattern (API Gateway)
```
✅ Implémentation: express-http-proxy
└─ Concentre la logique de routing
└─ Centralise l'authentification (futur)
└─ Cache à la gateway (futur)
```

### 2. Topic Exchange Pattern (RabbitMQ)
```
✅ Implémentation: RabbitMQ Topic Exchange
└─ Découplage complet (loose coupling)
└─ Multi-consumers possibles (scalabilité)
└─ Flexible routing avec wildcards
└─ Example: order.* → tous les events d'ordre
```

### 3. Cache-Aside Pattern (Redis)
```
✅ Implémentation: Manual cache invalidation
└─ Check cache first
└─ Si miss: query database
└─ Store in cache for future
└─ Reduce database load ~70-80%
```

---

## 6️⃣ Performance & Latency

### Latency Estimées

| Opération | Network | Cache | DB | Total |
|-----------|---------|-------|----|----|
| List Products (cache hit) | 5ms | 10ms | 0ms | ~15ms |
| List Products (cache miss) | 5ms | 5ms | 100ms | ~110ms |
| Create Order | 10ms | - | 50ms | ~60ms |
| Order Notification (async) | 5ms (RMQ) | - | 80ms | ~85ms (async, non-blocking) |
| Authenticate User | 10ms | 10ms | 80ms | ~100ms |

### Bottlenecks Potentiels
- 🔴 PostgreSQL (queries lentes) → Indexes, Query optimization
- 🟡 RabbitMQ (saturation) → Increase consumers
- 🟡 Redis (eviction) → Increase memory
- 🔴 Network latency → Kubernetes local clusters

---

## 7️⃣ Failure Scenarios & Recovery

### Scénario: PostgreSQL Down
```
Impact:
- ❌ Product Service: Cannot read/write
- ❌ Order Service: Cannot persist
- ❌ Notification Service: Cannot read details
- ✅ API Gateway: Still responding (500 errors)

Recovery:
1. Services retry with backoff
2. Health checks detect failure
3. Client receives 503 Service Unavailable
4. Database restored
5. Services reconnect automatically
```

### Scénario: RabbitMQ Down
```
Impact:
- ✅ API requests still work (sync)
- ❌ Order notifications delayed/lost
- ✅ Messages queued locally (if persistent)

Recovery:
1. Order Service retries connection
2. RabbitMQ restored
3. Pending messages reprocessed
4. Notifications sent
```

### Scénario: Redis Down
```
Impact:
- ⚠️ Cache miss → Database load increases
- ⚠️ Performance degrades (~5-10x slower)
- ✅ No data loss (cache only)

Recovery:
1. Redis restored
2. Cache gradually repopulated
3. Performance normalizes
```

