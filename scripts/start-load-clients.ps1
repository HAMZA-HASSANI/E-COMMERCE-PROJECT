param (
    [switch]$SkipBuild = $false,
    [switch]$Follow    = $false
)

# Construit (sauf si -SkipBuild) et deploie les 3 clients REST de charge :
# browse-client, shopper-client, stress-client.
# Trafic continu sur l'API Gateway tant que les pods tournent.
#
# Usage:
#   .\scripts\start-load-clients.ps1                # build + deploy
#   .\scripts\start-load-clients.ps1 -SkipBuild     # deploy uniquement
#   .\scripts\start-load-clients.ps1 -Follow        # build + deploy + tail logs
#
# Pour stopper : .\scripts\stop-load-clients.ps1

$ErrorActionPreference = "Stop"
$Namespace = "ecommerce"
$ManifestPath = Join-Path (Split-Path -Parent $PSScriptRoot) "kubernetes\11-load-clients.yaml"

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "Demarrage des clients REST de charge"        -ForegroundColor Cyan
Write-Host "=============================================`n" -ForegroundColor Cyan

# Sanity check : namespace + api-gateway doivent exister
$null = & kubectl get ns $Namespace 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Namespace '$Namespace' introuvable. Lancez d'abord .\scripts\start-platform.ps1" -ForegroundColor Red
    exit 1
}
$null = & kubectl get svc api-gateway -n $Namespace 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Service api-gateway absent. Lancez d'abord .\scripts\start-platform.ps1" -ForegroundColor Red
    exit 1
}

if (-not $SkipBuild) {
    Write-Host "[1/2] Construction des images des load-clients dans Minikube..." -ForegroundColor Yellow
    & minikube -p minikube docker-env --shell powershell | Invoke-Expression

    $clients = @("browse-client", "shopper-client", "stress-client")
    foreach ($client in $clients) {
        Write-Host "      -> ecommerce-${client}:latest" -ForegroundColor Gray
        docker build -t "ecommerce-${client}:latest" "./load-clients/$client" | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[ERROR] Echec de la construction de $client." -ForegroundColor Red
            exit 1
        }
    }
} else {
    Write-Host "[1/2] -SkipBuild : images supposees deja construites." -ForegroundColor DarkGray
}

Write-Host "`n[2/2] Deploiement des load-clients..." -ForegroundColor Yellow
kubectl apply -f $ManifestPath
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] kubectl apply a echoue." -ForegroundColor Red
    exit 1
}

# Si les deployments existaient deja, forcer un restart pour repartir sur les nouvelles images
$existing = & kubectl get deployment -n $Namespace -l role=load-generator -o name 2>$null
if ($existing) {
    Write-Host "      Restart pour reprendre sur les images fraiches..." -ForegroundColor Gray
    foreach ($d in $existing) {
        kubectl rollout restart $d -n $Namespace | Out-Null
    }
}

Write-Host "      Attente que les pods soient Ready..." -ForegroundColor Gray
kubectl rollout status deployment/browse-client  -n $Namespace --timeout=90s | Out-Null
kubectl rollout status deployment/shopper-client -n $Namespace --timeout=90s | Out-Null
kubectl rollout status deployment/stress-client  -n $Namespace --timeout=90s | Out-Null

Write-Host "`n[OK] Les 3 clients generent maintenant du trafic." -ForegroundColor Green
Write-Host ""
Write-Host "Suivi temps reel :" -ForegroundColor Cyan
Write-Host "  kubectl logs -n $Namespace -l role=load-generator -f --max-log-requests=10" -ForegroundColor Gray
Write-Host ""
Write-Host "Verifier les metriques montent (apres ~30s) :" -ForegroundColor Cyan
Write-Host "  Prometheus : http://localhost:9090/graph?g0.expr=job%3Ahttp_requests_total%3Arate5m" -ForegroundColor Gray
Write-Host "  Grafana    : http://localhost:3005 (folder Ecommerce Platform)" -ForegroundColor Gray
Write-Host ""
Write-Host "Stopper : .\scripts\stop-load-clients.ps1" -ForegroundColor DarkGray

if ($Follow) {
    Write-Host "`n--- Logs (Ctrl+C pour quitter sans arreter les clients) ---`n" -ForegroundColor Yellow
    kubectl logs -n $Namespace -l role=load-generator -f --max-log-requests=10
}
