# Guide de Démarrage Rapide (Kubernetes)

Ce guide est optimisé pour lancer, exploiter et superviser la plateforme E-Commerce directement sur un cluster Kubernetes local (Minikube).

---

## 1. Lancement de la Plateforme

### Option 1 : Script Automatique (Recommandé)
Démarre Minikube, construit les images, déploie toutes les ressources et provisionne les dashboards Grafana :
```powershell
.\scripts\start-platform.ps1
```
Switches :
- `-SkipBuild` — si les images sont déjà construites
- `-WithLoad` — construit + déploie aussi les 3 clients REST de charge (browse / shopper / stress)
- `-PortForward` — attend que les pods clés soient prêts, puis ouvre tous les `kubectl port-forward` automatiquement (chacun dans une fenêtre PowerShell minimisée)

Exemple **tout-en-un** (build + déploiement + port-forwards) :
```powershell
.\scripts\start-platform.ps1 -PortForward
```
Pour relancer rapidement après un premier build :
```powershell
.\scripts\start-platform.ps1 -SkipBuild -PortForward
```

### Option 2 : Lancement Manuel

**Démarrer le cluster**
```powershell
minikube start --driver=docker --cpus=4 --memory=4096
```

**Construire les images dans Minikube**
```powershell
& minikube docker-env --shell powershell | Invoke-Expression
docker build -t ecommerce-api-gateway:latest ./services/api-gateway
docker build -t ecommerce-product-service:latest ./services/product-service
docker build -t ecommerce-user-service:latest ./services/user-service
docker build -t ecommerce-order-service:latest ./services/order-service
docker build -t ecommerce-notification-service:latest ./services/notification-service
```

**Déployer l'infrastructure**
```powershell
kubectl apply -f kubernetes/00-namespace-config.yaml
kubectl apply -f kubernetes/01-postgres.yaml
kubectl apply -f kubernetes/02-redis.yaml
kubectl apply -f kubernetes/03-rabbitmq.yaml
kubectl apply -f kubernetes/04-microservices.yaml
kubectl apply -f kubernetes/05-api-gateway.yaml
kubectl apply -f kubernetes/06-notification-services.yaml
kubectl apply -f kubernetes/07-prometheus.yaml
kubectl apply -f kubernetes/08-grafana.yaml
kubectl apply -f kubernetes/09-alertmanager.yaml
kubectl apply -f kubernetes/10-exporters.yaml
.\scripts\apply-grafana-dashboards.ps1
```

---

## 2. Accès aux Dashboards (Port-Forwarding)

> Sur Kubernetes, les services sont en `ClusterIP` → **rien n'est exposé hors du cluster par défaut**. Tant qu'aucun `kubectl port-forward` n'est actif, les URL `localhost:xxxx` sont injoignables. C'est attendu.

### Option A — Tout démarrer en une commande (recommandé)
```powershell
.\scripts\start-port-forwards.ps1
```
Ce script :
- vérifie pour chaque service qu'il existe dans le cluster (skip sinon)
- vérifie que le port local n'est pas déjà occupé (skip sinon)
- lance chaque `kubectl port-forward` dans une **fenêtre PowerShell séparée minimisée** (titre `pf:<service>`) — facile à voir/fermer

Pour tout arrêter d'un coup :
```powershell
.\scripts\stop-port-forwards.ps1
```

### Option B — Manuel (un terminal par service)

**Microservices & Infra**
```powershell
kubectl port-forward svc/api-gateway 3000:3000 -n ecommerce      # http://localhost:3000
kubectl port-forward svc/rabbitmq 15672:15672 -n ecommerce       # http://localhost:15672 (guest/guest)
kubectl port-forward svc/mailhog 8025:8025 -n ecommerce          # http://localhost:8025
```

**Stack de Supervision**
```powershell
kubectl port-forward svc/grafana 3005:3000 -n ecommerce          # http://localhost:3005 (admin/admin)
kubectl port-forward svc/prometheus 9090:9090 -n ecommerce       # http://localhost:9090
kubectl port-forward svc/alertmanager 9093:9093 -n ecommerce     # http://localhost:9093
```

### Tester les Endpoints (via l'API Gateway)
```powershell
# Lister les produits
curl.exe http://localhost:3000/api/products/

# Créer une commande (auth requise — d'abord login pour obtenir un token)
curl.exe -X POST http://localhost:3000/api/orders/ `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer <TOKEN>" `
  -d '{\"userId\":1,\"items\":[{\"productId\":1,\"quantity\":2}],\"totalAmount\":1999.98}'
```

---

## 3. Supervision (Prometheus + Grafana + Alertmanager)

### Vérifier que Prometheus voit toutes les cibles
1. `kubectl port-forward svc/prometheus 9090:9090 -n ecommerce`
2. Ouvrir http://localhost:9090/targets
3. Tous les jobs doivent être en **UP** : `api-gateway`, `product-service`, `user-service`, `order-service`, `notification-service`, `node-exporter`, `postgres-exporter`, `redis-exporter`, `rabbitmq`.

### Voir les règles d'alerte
- http://localhost:9090/alerts — règles Prometheus
- http://localhost:9093 — Alertmanager (alertes en cours, silences)

### Dashboards Grafana pré-provisionnés
Sur http://localhost:3005 (folder **Ecommerce Platform**) :
- **Microservices Overview** — santé, RPS, erreurs, latence p95/p99 par service
- **API Gateway** — détail routes, status codes, auth failures, rate-limit
- **Business Metrics** — orders créés, emails envoyés/échoués, cache hit ratio
- **Infrastructure** — CPU/mem/disque host, Postgres, Redis, RabbitMQ

### Mettre à jour les dashboards
Après avoir édité un fichier `grafana/dashboards/*.json` :
```powershell
.\scripts\apply-grafana-dashboards.ps1
kubectl rollout restart deployment/grafana -n ecommerce
```

### Recharger Prometheus / Alertmanager après modification de configs
Les ConfigMaps `prometheus-config`, `prometheus-alerts`, `alertmanager-config` sont éditables. Après `kubectl apply -f kubernetes/07-prometheus.yaml` (ou `09-alertmanager.yaml`) :
```powershell
kubectl rollout restart deployment/prometheus -n ecommerce
kubectl rollout restart deployment/alertmanager -n ecommerce
```

### Recevoir les alertes (par défaut, MailHog)
Toutes les alertes sont envoyées à MailHog (SMTP `mailhog:1025`). Visibles dans :
- http://localhost:8025 (port-forward MailHog)

Pour brancher un canal réel (Slack, PagerDuty…), éditer `kubernetes/09-alertmanager.yaml` puis appliquer + redémarrer.

---

## 4. Générer du trafic (Load Clients REST)

3 clients Node.js sont disponibles dans `load-clients/` :
- **browse-client** — visiteur anonyme parcourant le catalogue
- **shopper-client** — acheteur authentifié (register → login → order)
- **stress-client** — bursts concurrents avec ratio d'erreurs intentionnelles

### Démarrer (script dédié — recommandé)
Un script séparé permet de lancer/arrêter le trafic indépendamment de la plateforme :

```powershell
# Build des images + déploiement des 3 clients
.\scripts\start-load-clients.ps1

# Re-déployer sans rebuild (si images déjà en place)
.\scripts\start-load-clients.ps1 -SkipBuild

# Lancer + suivre les logs immédiatement (Ctrl+C n'arrête PAS les clients, juste les logs)
.\scripts\start-load-clients.ps1 -Follow
```

Le script vérifie que la plateforme est déployée, construit les images dans Minikube si nécessaire, applique le manifest et redémarre les pods pour repartir sur les images fraîches.

### Démarrer (en même temps que la plateforme)
```powershell
.\scripts\start-platform.ps1 -SkipBuild -WithLoad
```

### Démarrer (manuellement)
```powershell
& minikube docker-env --shell powershell | Invoke-Expression
docker build -t ecommerce-browse-client:latest   ./load-clients/browse-client
docker build -t ecommerce-shopper-client:latest  ./load-clients/shopper-client
docker build -t ecommerce-stress-client:latest   ./load-clients/stress-client
kubectl apply -f kubernetes/11-load-clients.yaml
```

### Suivre les logs
```powershell
kubectl logs -n ecommerce -l role=load-generator -f --max-log-requests=10
# ou un seul
kubectl logs -n ecommerce -l app=stress-client -f
```

### Arrêter les clients
```powershell
.\scripts\stop-load-clients.ps1            # delete deployments
.\scripts\stop-load-clients.ps1 -Purge     # delete + remove docker images
```
ou directement :
```powershell
kubectl delete -f kubernetes/11-load-clients.yaml
```

### Pousser plus fort pour déclencher les alertes
```powershell
kubectl set env deployment/stress-client -n ecommerce ERROR_RATIO=0.4 CONCURRENCY=20 REQUESTS_PER_BURST=100 BURST_INTERVAL_MS=200
```

---

## 5. Débogage

### Vérifier l'état des pods
```powershell
kubectl get pods -n ecommerce -w
```

### Logs d'un service
```powershell
kubectl logs -n ecommerce -l app=product-service -f
```
*Composants disponibles : `api-gateway`, `product-service`, `user-service`, `order-service`, `notification-service`, `prometheus`, `grafana`, `alertmanager`, `node-exporter`, `postgres-exporter`, `redis-exporter`, `rabbitmq`, `postgres`, `redis`, `mailhog`.*

### Comprendre un crash de pod
```powershell
kubectl describe pod -n ecommerce -l app=rabbitmq
kubectl logs -n ecommerce -l app=rabbitmq --previous
```

### Accès direct PostgreSQL
```powershell
kubectl exec -it deployment/postgres -n ecommerce -- psql -U postgres -d ecommerce
```

### Scaling
```powershell
kubectl scale deployment product-service --replicas=3 -n ecommerce
```

---

## 6. Résumé des URLs (après port-forward)

| Service | URL | Credentials |
|---------|-----|-------------|
| API Gateway | http://localhost:3000 | — |
| Grafana | http://localhost:3005 | admin / admin |
| Prometheus | http://localhost:9090 | — |
| Alertmanager | http://localhost:9093 | — |
| MailHog (alertes/emails) | http://localhost:8025 | — |
| RabbitMQ Management | http://localhost:15672 | guest / guest |

---

## 7. 🛑 Arrêter la Plateforme

Vous avez plusieurs niveaux pour arrêter la plateforme selon vos besoins :

### Niveau 1 : Fermer les accès (Garder le cluster en arrière-plan)
Si vous voulez juste fermer les terminaux de port-forwarding :
```powershell
.\scripts\stop-port-forwards.ps1
```

### Niveau 2 : Mettre en pause (Recommandé pour la fin de journée)
Arrête la machine virtuelle Minikube. **Toutes vos données (produits, base de données, configurations) seront conservées** pour le prochain lancement.
```powershell
minikube stop
```
*(Pour relancer plus tard, un simple `minikube start` suffira !)*

### Niveau 3 : Destruction Totale (Remise à zéro)
Supprime complètement le cluster Kubernetes et toutes les données de la base de données. Idéal si vous voulez repartir d'une page blanche.
```powershell
minikube delete
```
