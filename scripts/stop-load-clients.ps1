param (
    [switch]$Purge = $false
)

# Stoppe les 3 clients REST de charge.
# Par defaut : delete les deployments (mais garde les images dans Minikube).
# -Purge   : supprime aussi les images docker dans Minikube.
#
# Usage:
#   .\scripts\stop-load-clients.ps1
#   .\scripts\stop-load-clients.ps1 -Purge

$ErrorActionPreference = "SilentlyContinue"
$Namespace = "ecommerce"
$ManifestPath = Join-Path (Split-Path -Parent $PSScriptRoot) "kubernetes\11-load-clients.yaml"

Write-Host "Arret des load-clients..." -ForegroundColor Yellow
kubectl delete -f $ManifestPath --ignore-not-found=true

if ($Purge) {
    Write-Host "`nSuppression des images dans Minikube..." -ForegroundColor Yellow
    & minikube -p minikube docker-env --shell powershell | Invoke-Expression
    foreach ($client in @("browse-client", "shopper-client", "stress-client")) {
        docker rmi "ecommerce-${client}:latest" 2>$null | Out-Null
        Write-Host "  -> ecommerce-${client}:latest" -ForegroundColor Gray
    }
}

Write-Host "`n[OK] Load-clients stoppes." -ForegroundColor Green
