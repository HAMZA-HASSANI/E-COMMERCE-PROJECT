# Monitoring & Alerting Stack

Cette stack apporte la supervision complète et l'alerting pour la plateforme ecommerce.

## Composants

| Service | Port | URL | Rôle |
|---------|------|-----|------|
| Prometheus | 9090 | http://localhost:9090 | Collecte des métriques + évaluation des règles |
| Alertmanager | 9093 | http://localhost:9093 | Routing et envoi des alertes |
| Grafana | 3005 | http://localhost:3005 | Dashboards (admin/admin par défaut) |
| Node Exporter | 9100 | http://localhost:9100/metrics | Métriques host (CPU, RAM, disque) |
| Postgres Exporter | 9187 | http://localhost:9187/metrics | Métriques PostgreSQL |
| Redis Exporter | 9121 | http://localhost:9121/metrics | Métriques Redis |
| RabbitMQ (prom plugin) | 15692 | http://localhost:15692/metrics | Métriques broker |
| MailHog | 8025 | http://localhost:8025 | Inbox de test (reçoit les alertes email) |

## Démarrage

```bash
docker-compose up -d
```

Puis :
- Vérifier les cibles Prometheus : http://localhost:9090/targets
- Voir les règles d'alerte : http://localhost:9090/alerts
- Ouvrir Grafana : http://localhost:3005 (admin / admin)
- Voir les emails d'alerte reçus : http://localhost:8025

## Arborescence

```
prometheus/
├── prometheus.yml              # Config Prometheus principale
└── alerts/
    ├── recording_rules.yml     # Métriques normalisées (job:http_*)
    ├── microservices.yml       # Alertes services + métier
    └── infrastructure.yml      # Alertes infra (host, DB, cache, broker)

alertmanager/
└── alertmanager.yml            # Routing + receivers email

grafana/
├── provisioning/
│   ├── datasources/prometheus.yml   # Datasource auto-provisionné
│   └── dashboards/dashboards.yml    # Provider de dashboards
└── dashboards/
    ├── microservices-overview.json  # Vue d'ensemble services
    ├── api-gateway.json             # Détails API Gateway
    ├── business-metrics.json        # KPIs métier (orders, emails, cache)
    └── infrastructure.json          # Host, DB, cache, broker

rabbitmq/
└── enabled_plugins             # Active le plugin prometheus
```

## Recording rules

Les métriques HTTP sont préfixées par service (`api_gateway_http_requests_total`,
`product_service_http_requests_total`, …). Pour écrire des alertes et dashboards
portables, des **recording rules** normalisent ces métriques :

| Recording rule | Description |
|----------------|-------------|
| `job:http_requests_total:rate5m` | req/s par service |
| `job:http_5xx:rate5m` | req/s avec status 5xx |
| `job:http_error_ratio_5xx:ratio5m` | ratio d'erreurs 5xx |
| `job:http_error_ratio_4xx:ratio5m` | ratio d'erreurs 4xx |
| `job:http_request_duration_seconds:p50/p95/p99` | percentiles de latence |

## Catalogue d'alertes

### Disponibilité
- `ServiceDown` (critical) — service inaccessible > 1 min
- `ServiceFlapping` (warning) — > 4 redémarrages en 10 min

### Performance
- `HighRequestLatencyP95` (warning) — p95 > 1s pendant 5 min
- `VeryHighRequestLatencyP99` (critical) — p99 > 3s pendant 5 min

### Erreurs
- `HighHttp5xxErrorRate` (critical) — taux 5xx > 5%
- `ElevatedHttp4xxErrorRate` (warning) — taux 4xx > 20% pendant 10 min

### Sécurité
- `AuthFailureSpike` (warning) — auth failures > 1/s
- `RateLimitRejectionSpike` (warning) — rejections > 5/s

### Métier
- `NoOrdersCreated` (warning) — aucune commande en 30 min (heures ouvrées)
- `HighEmailFailureRate` (warning) — échecs d'envoi > 10%
- `LowProductCacheHitRatio` (info) — hit ratio Redis < 50%

### Runtime Node.js
- `NodeJsHighHeapUsage` (warning) — heap > 90% pendant 10 min
- `NodeJsEventLoopLag` (warning) — lag > 200ms pendant 5 min

### Infrastructure
- `HostHighCpuUsage` (warning) — CPU host > 85% pendant 10 min
- `HostHighMemoryUsage` (warning) — RAM > 90%
- `HostLowDiskSpace` / `HostCriticalDiskSpace` (warning / critical)
- `PostgresDown` / `PostgresTooManyConnections` / `PostgresSlowQueries`
- `RedisDown` / `RedisHighMemoryUsage` / `RedisRejectedConnections`
- `RabbitMqDown` / `RabbitMqQueueBacklog`

## Routing Alertmanager

| Catégorie | Receiver | Repeat interval |
|-----------|----------|-----------------|
| `severity=critical` | oncall@ecommerce-platform.local | 1h |
| `category=security` | security@ecommerce-platform.local | 30m |
| `category=business` | product@ecommerce-platform.local | 2h |
| `category=infrastructure/database/cache/broker` | ops@ecommerce-platform.local | 2h |
| Reste | devteam@ecommerce-platform.local | 4h |

Les emails sont envoyés via MailHog (SMTP `mailhog:1025`), consultables sur http://localhost:8025.

### Brancher un vrai canal (Slack, PagerDuty, …)

Modifier `alertmanager/alertmanager.yml` puis recharger :

```bash
docker-compose restart alertmanager
```

Exemple Slack :

```yaml
- name: 'critical-receiver'
  slack_configs:
    - api_url: 'https://hooks.slack.com/services/XXX/YYY/ZZZ'
      channel: '#oncall'
      send_resolved: true
```

## Recharger la configuration sans redémarrer

```bash
# Prometheus
curl -X POST http://localhost:9090/-/reload

# Alertmanager
curl -X POST http://localhost:9093/-/reload
```

## Tester une alerte

Forcer une alerte `ServiceDown` :

```bash
docker-compose stop product-service
# Attendre 1 min, vérifier http://localhost:9090/alerts
# Puis http://localhost:8025 pour voir l'email
docker-compose start product-service
```

## Variables d'environnement

À ajouter dans `.env` (optionnel) :

```env
GRAFANA_ADMIN_PASSWORD=changeme
```
