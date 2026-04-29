# Creates/updates Grafana dashboard ConfigMaps in the `ecommerce` namespace.
# One ConfigMap per subfolder under grafana/dashboards/ → one Grafana folder per category.
# Falls back to a single flat ConfigMap if no subfolders exist.
#
# Usage:
#   .\scripts\apply-grafana-dashboards.ps1
#   .\scripts\apply-grafana-dashboards.ps1 -Restart   # also restarts Grafana

param([switch]$Restart = $false)

$ErrorActionPreference = "Stop"

$repoRoot       = Split-Path -Parent $PSScriptRoot
$dashboardsPath = Join-Path $repoRoot "grafana\dashboards"

if (-not (Test-Path $dashboardsPath)) {
    Write-Host "[ERROR] Dashboards directory not found: $dashboardsPath" -ForegroundColor Red
    exit 1
}

# Collect subfolders (one per Grafana folder category)
$subfolders = Get-ChildItem -Path $dashboardsPath -Directory | Sort-Object Name

if ($subfolders.Count -eq 0) {
    # Legacy flat mode: single ConfigMap from root-level JSON files
    $files = Get-ChildItem -Path $dashboardsPath -Filter *.json
    if ($files.Count -eq 0) {
        Write-Host "[WARN] No dashboard JSON files found." -ForegroundColor Yellow
        exit 0
    }
    Write-Host "Building grafana-dashboards ConfigMap (flat) from $($files.Count) file(s)..." -ForegroundColor Cyan
    [string[]]$fromFileArgs = @($files | ForEach-Object { "--from-file=$($_.FullName)" })
    $yaml = & kubectl create configmap grafana-dashboards -n ecommerce @fromFileArgs --dry-run=client -o yaml
    $yaml | & kubectl apply -f -
} else {
    # Structured mode: one ConfigMap per subfolder
    Write-Host "Building Grafana dashboard ConfigMaps (structured - $($subfolders.Count) folder(s))..." -ForegroundColor Cyan

    foreach ($folder in $subfolders) {
        $files = Get-ChildItem -Path $folder.FullName -Filter *.json
        if ($files.Count -eq 0) {
            Write-Host "  [SKIP] $($folder.Name) - no JSON files" -ForegroundColor DarkGray
            continue
        }

        # ConfigMap name: grafana-dashboards-<sanitized-folder-name>
        $cmName = "grafana-dashboards-" + ($folder.Name.ToLower() -replace '[^a-z0-9]', '-')

        Write-Host "  -> $cmName  ($($files.Count) dashboard(s): $($files.Name -join ', '))" -ForegroundColor Gray

        [string[]]$fromFileArgs = @($files | ForEach-Object { "--from-file=$($_.FullName)" })
        $yaml = & kubectl create configmap $cmName -n ecommerce @fromFileArgs --dry-run=client -o yaml
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  [ERROR] Failed to build ConfigMap for $($folder.Name)" -ForegroundColor Red
            exit 1
        }
        $yaml | & kubectl apply -f -
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  [ERROR] kubectl apply failed for $cmName" -ForegroundColor Red
            exit 1
        }
    }
    Write-Host "[OK] All dashboard ConfigMaps applied." -ForegroundColor Green
}

if ($Restart) {
    Write-Host "Restarting Grafana deployment..." -ForegroundColor Yellow
    kubectl rollout restart deployment/grafana -n ecommerce
    kubectl rollout status  deployment/grafana -n ecommerce --timeout=60s
    Write-Host "[OK] Grafana restarted." -ForegroundColor Green
} else {
    Write-Host "     To apply changes: kubectl rollout restart deployment/grafana -n ecommerce" -ForegroundColor Gray
}
