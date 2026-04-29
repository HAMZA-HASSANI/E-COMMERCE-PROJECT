param (
    [switch]$SkipBuild   = $false,
    [switch]$WithLoad    = $false,
    [switch]$PortForward = $false
)

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "Demarrage de la Plateforme E-Commerce" -ForegroundColor Cyan
Write-Host "=============================================`n" -ForegroundColor Cyan

# 1. Demarrer Minikube
Write-Host "[1/5] Demarrage de Minikube..." -ForegroundColor Yellow
minikube start --driver=docker --cpus=4 --memory=4096

if ($LASTEXITCODE -ne 0) {
    Write-Host "Erreur lors du demarrage de Minikube." -ForegroundColor Red
    exit 1
}

if (-not $SkipBuild) {
    # 2. Configurer Docker pour utiliser l'environnement Minikube
    Write-Host "`n[2/5] Configuration de l'environnement Docker de Minikube..." -ForegroundColor Yellow
    & minikube -p minikube docker-env --shell powershell | Invoke-Expression

    # 3. Construire les images Docker des microservices
    Write-Host "`n[3/5] Construction des images des microservices..." -ForegroundColor Yellow

    $services = @("api-gateway", "product-service", "user-service", "order-service", "notification-service")
    foreach ($service in $services) {
        Write-Host "      -> ecommerce-${service}:latest" -ForegroundColor Gray
        docker build -t "ecommerce-${service}:latest" "./services/$service" | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Erreur lors de la construction de l'image $service." -ForegroundColor Red
            exit 1
        }
    }

    if ($WithLoad) {
        Write-Host "`n      Construction des images load-clients..." -ForegroundColor Yellow
        $clients = @("browse-client", "shopper-client", "stress-client")
        foreach ($client in $clients) {
            Write-Host "      -> ecommerce-${client}:latest" -ForegroundColor Gray
            docker build -t "ecommerce-${client}:latest" "./load-clients/$client" | Out-Null
            if ($LASTEXITCODE -ne 0) {
                Write-Host "Erreur lors de la construction de l'image $client." -ForegroundColor Red
                exit 1
            }
        }
    }
} else {
    Write-Host "`n[2/5 & 3/5] Script lance avec -SkipBuild. Images ignorees." -ForegroundColor DarkGray
}

# 4. Deployer l'infrastructure Kubernetes
Write-Host "`n[4/5] Deploiement des ressources Kubernetes..." -ForegroundColor Yellow
# On exclut 11-load-clients par defaut (deploye seulement si -WithLoad).
$manifests = Get-ChildItem -Path "kubernetes" -Filter "*.yaml" |
    Where-Object { $_.Name -ne "11-load-clients.yaml" }

foreach ($m in $manifests) {
    kubectl apply -f $m.FullName
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Erreur lors du deploiement de $($m.Name)." -ForegroundColor Red
        exit 1
    }
}

# 5. Provisionner les dashboards Grafana + (optionnel) load clients
Write-Host "`n[5/5] Provisionnement des dashboards Grafana..." -ForegroundColor Yellow
& "$PSScriptRoot\apply-grafana-dashboards.ps1"

if ($WithLoad) {
    Write-Host "`n      Deploiement des load-clients..." -ForegroundColor Yellow
    kubectl apply -f kubernetes/11-load-clients.yaml
}

Write-Host "`nTermine ! Toutes les ressources ont ete soumises au cluster." -ForegroundColor Green
Write-Host "Suivez le demarrage : kubectl get pods -n ecommerce -w" -ForegroundColor Cyan
Write-Host ""

if ($PortForward) {
    Write-Host "Attente que les pods cles soient prets avant les port-forwards..." -ForegroundColor Yellow
    $deployments = @("api-gateway", "grafana", "prometheus")
    foreach ($d in $deployments) {
        kubectl rollout status deployment/$d -n ecommerce --timeout=180s | Out-Null
    }
    Write-Host ""
    & "$PSScriptRoot\start-port-forwards.ps1"
} else {
    Write-Host "Acces aux dashboards (chacun dans un terminal) :" -ForegroundColor Cyan
    Write-Host "  kubectl port-forward svc/api-gateway 3000:3000 -n ecommerce" -ForegroundColor Gray
    Write-Host "  kubectl port-forward svc/grafana 3005:3000 -n ecommerce       --> http://localhost:3005 (admin/admin)" -ForegroundColor Gray
    Write-Host "  kubectl port-forward svc/prometheus 9090:9090 -n ecommerce    --> http://localhost:9090" -ForegroundColor Gray
    Write-Host "  kubectl port-forward svc/alertmanager 9093:9093 -n ecommerce  --> http://localhost:9093" -ForegroundColor Gray
    Write-Host "  kubectl port-forward svc/mailhog 8025:8025 -n ecommerce       --> http://localhost:8025" -ForegroundColor Gray
    Write-Host "  kubectl port-forward svc/rabbitmq 15672:15672 -n ecommerce    --> http://localhost:15672 (guest/guest)" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Astuce : ajoutez -PortForward pour lancer tous les port-forwards automatiquement." -ForegroundColor DarkGray
    Write-Host "         .\scripts\start-platform.ps1 -SkipBuild -PortForward" -ForegroundColor DarkGray
}

Write-Host ""
if (-not $WithLoad) {
    Write-Host "Pour lancer les clients de charge : .\scripts\start-platform.ps1 -SkipBuild -WithLoad" -ForegroundColor DarkGray
}
