# Creates/updates the `grafana-dashboards` ConfigMap in the `ecommerce` namespace
# from every JSON file under grafana/dashboards/.
#
# Usage:
#   .\scripts\apply-grafana-dashboards.ps1
#
# After applying, restart the grafana pod so it remounts the new ConfigMap:
#   kubectl rollout restart deployment/grafana -n ecommerce

$ErrorActionPreference = "Stop"

$repoRoot       = Split-Path -Parent $PSScriptRoot
$dashboardsPath = Join-Path $repoRoot "grafana\dashboards"

if (-not (Test-Path $dashboardsPath)) {
    Write-Host "[ERROR] Dashboards directory not found: $dashboardsPath" -ForegroundColor Red
    exit 1
}

$dashboardFiles = Get-ChildItem -Path $dashboardsPath -Filter *.json
if ($dashboardFiles.Count -eq 0) {
    Write-Host "[WARN] No dashboard JSON files found in $dashboardsPath" -ForegroundColor Yellow
    exit 0
}

Write-Host "Building grafana-dashboards ConfigMap from $($dashboardFiles.Count) file(s)..." -ForegroundColor Cyan
$fromFileArgs = $dashboardFiles | ForEach-Object { "--from-file=$($_.FullName)" }

$yaml = & kubectl create configmap grafana-dashboards `
    -n ecommerce `
    @fromFileArgs `
    --dry-run=client -o yaml

if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] kubectl create configmap (dry-run) failed." -ForegroundColor Red
    exit 1
}

$yaml | & kubectl apply -f -

if ($LASTEXITCODE -eq 0) {
    Write-Host "[OK] grafana-dashboards ConfigMap applied." -ForegroundColor Green
    Write-Host "     Restart Grafana to pick up changes:" -ForegroundColor Gray
    Write-Host "       kubectl rollout restart deployment/grafana -n ecommerce" -ForegroundColor Gray
} else {
    Write-Host "[ERROR] kubectl apply failed." -ForegroundColor Red
    exit 1
}
