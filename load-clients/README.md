# Load-Generating REST Clients

Trois clients Node.js qui génèrent du trafic en continu vers la plateforme via l'API Gateway. Ils servent à :

- **alimenter Prometheus** en métriques pour valider dashboards et alertes
- **stresser** la plateforme et déclencher les seuils d'alerte
- **simuler des comportements utilisateurs** réalistes

Tous les clients sont **opt-in** via le profile Docker Compose `load` — ils ne démarrent pas avec un `docker-compose up` standard.

## Les 3 clients

| Client | Profil de trafic | Auth | Cas d'usage |
|--------|------------------|------|-------------|
| **browse-client** | Lecture catalogue (GET /api/products, détails, /health) | Anonyme | Trafic de fond réaliste |
| **shopper-client** | Cycle complet : register → login → browse → order | JWT | Métriques métier (orders_created, emails) |
| **stress-client** | Bursts concurrents avec ratio d'erreurs intentionnelles | Mixte | Déclencher alertes 4xx/5xx/rate-limit/auth |

## Démarrage

### Tout (plateforme + clients)
```bash
docker-compose --profile load up -d
```

### Plateforme seule (par défaut, sans clients)
```bash
docker-compose up -d
```

### Un seul client
```bash
docker-compose --profile load up -d browse-client
```

### Arrêter les clients sans toucher à la plateforme
```bash
docker-compose stop browse-client shopper-client stress-client
```

### Voir les logs
```bash
docker-compose logs -f browse-client shopper-client stress-client
```

Chaque client log un résumé toutes les 30 secondes :
```
[stress-client] last 30s — total=600 ok=510 4xx=72 429=0 5xx=0 net=0 (15.0% err)
```

## Variables d'environnement

### browse-client
| Var | Défaut | Rôle |
|-----|--------|------|
| `API_BASE_URL` | `http://api-gateway:3000` | Cible |
| `MIN_INTERVAL_MS` | `500` | Délai mini entre requêtes |
| `MAX_INTERVAL_MS` | `2000` | Délai maxi entre requêtes |

### shopper-client
| Var | Défaut | Rôle |
|-----|--------|------|
| `API_BASE_URL` | `http://api-gateway:3000` | Cible |
| `MIN_CYCLE_MS` | `4000` | Délai mini entre cycles d'achat |
| `MAX_CYCLE_MS` | `10000` | Délai maxi entre cycles |
| `SHOPPER_PASSWORD` | `Password123!` | Mot de passe utilisé pour register/login |

### stress-client
| Var | Défaut | Rôle |
|-----|--------|------|
| `API_BASE_URL` | `http://api-gateway:3000` | Cible |
| `CONCURRENCY` | `5` | Requêtes en parallèle dans un burst |
| `REQUESTS_PER_BURST` | `20` | Taille de burst |
| `BURST_INTERVAL_MS` | `1000` | Pause entre bursts |
| `ERROR_RATIO` | `0.15` | Fraction de requêtes intentionnellement invalides (0–1) |

### Exemple : pousser plus fort pour déclencher les alertes
```bash
ERROR_RATIO=0.4 CONCURRENCY=20 REQUESTS_PER_BURST=100 BURST_INTERVAL_MS=200 \
  docker-compose --profile load up -d stress-client
```

(Avec `ERROR_RATIO=0.4`, le taux 4xx dépassera 20% → l'alerte `ElevatedHttp4xxErrorRate` se déclenchera après 10 min.)

## Que regarder ?

Une fois les clients lancés :

- **Prometheus** : http://localhost:9090/graph — `job:http_requests_total:rate5m`
- **Grafana** :
  - http://localhost:3005/d/ms-overview — vue d'ensemble services
  - http://localhost:3005/d/api-gateway — détail du gateway
  - http://localhost:3005/d/business-metrics — orders & emails
- **Alertmanager** : http://localhost:9093 — alertes en cours
- **MailHog** : http://localhost:8025 — emails d'alerte reçus

## Lancer un client en local (hors Docker)

Depuis chaque dossier :
```bash
cd load-clients/browse-client
npm install
API_BASE_URL=http://localhost:3000 npm start
```
