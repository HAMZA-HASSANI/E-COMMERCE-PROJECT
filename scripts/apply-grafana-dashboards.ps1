# Creates/updates Grafana dashboard ConfigMaps in the `ecommerce` namespace.
# One ConfigMap per subfolder under grafana/dashboards/ -> one Grafana folder per category.
# Falls back to a single flat ConfigMap if no subfolders exist.
#
# Strategy: delete + recreate each ConfigMap directly from files.
# This avoids the PowerShell string-encoding corruption that occurs when piping
# kubectl stdout (UTF-8) through $OutputEncoding-mangled PS variables (ASCII default).
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

function Apply-DashboardConfigMap {
    param([string]$CmName, [System.IO.FileInfo[]]$Files, [string]$Namespace = "ecommerce")

    [string[]]$fromFileArgs = @($Files | ForEach-Object { "--from-file=$($_.FullName)" })

    # Delete if exists, then recreate directly from files.
    # Never pipes file content through PowerShell strings, so UTF-8 chars are preserved.
    & kubectl delete configmap $CmName -n $Namespace --ignore-not-found 2>&1 | Out-Null

    & kubectl create configmap $CmName -n $Namespace @fromFileArgs
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  [ERROR] kubectl create failed for $CmName" -ForegroundColor Red
        exit 1
    }
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
    Write-Host "Applying grafana-dashboards ConfigMap (flat) from $($files.Count) file(s)..." -ForegroundColor Cyan
    Apply-DashboardConfigMap -CmName "grafana-dashboards" -Files $files
} else {
    # Structured mode: one ConfigMap per subfolder
    Write-Host "Applying Grafana dashboard ConfigMaps (structured - $($subfolders.Count) folder(s))..." -ForegroundColor Cyan

    foreach ($folder in $subfolders) {
        $files = Get-ChildItem -Path $folder.FullName -Filter *.json
        if ($files.Count -eq 0) {
            Write-Host "  [SKIP] $($folder.Name) - no JSON files" -ForegroundColor DarkGray
            continue
        }

        # ConfigMap name: grafana-dashboards-<sanitized-folder-name>
        $cmName = "grafana-dashboards-" + ($folder.Name.ToLower() -replace '[^a-z0-9]', '-')

        Write-Host "  -> $cmName  ($($files.Count) dashboard(s): $($files.Name -join ', '))" -ForegroundColor Gray
        Apply-DashboardConfigMap -CmName $cmName -Files $files
    }
}

Write-Host "[OK] All dashboard ConfigMaps applied." -ForegroundColor Green

if ($Restart) {
    Write-Host "Restarting Grafana deployment..." -ForegroundColor Yellow
    kubectl rollout restart deployment/grafana -n ecommerce
    kubectl rollout status  deployment/grafana -n ecommerce --timeout=120s
    Write-Host "[OK] Grafana restarted." -ForegroundColor Green
} else {
    Write-Host "     To apply changes: kubectl rollout restart deployment/grafana -n ecommerce" -ForegroundColor Gray
}
