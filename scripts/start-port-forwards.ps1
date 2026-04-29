param (
    [switch]$Quiet       = $false,
    [switch]$ShowWindows = $false
)

# Lance un kubectl port-forward pour chaque service exposable de la plateforme.
# Chaque port-forward tourne dans un processus PowerShell cache en arriere-plan
# (pas de fenetre visible). Pour les lister/arreter : stop-port-forwards.ps1.
#
# Usage:
#   .\scripts\start-port-forwards.ps1
#   .\scripts\start-port-forwards.ps1 -ShowWindows  # debug : fenetres minimisees visibles
# Pour tout arreter:
#   .\scripts\stop-port-forwards.ps1

$ErrorActionPreference = "Stop"
$Namespace = "ecommerce"

$forwards = @(
    [pscustomobject]@{ Svc = "api-gateway";  Local = 3000;  Remote = 3000; Note = "API principale" },
    [pscustomobject]@{ Svc = "grafana";      Local = 3005;  Remote = 3000; Note = "admin / admin" },
    [pscustomobject]@{ Svc = "prometheus";   Local = 9090;  Remote = 9090; Note = "" },
    [pscustomobject]@{ Svc = "alertmanager"; Local = 9093;  Remote = 9093; Note = "" },
    [pscustomobject]@{ Svc = "mailhog";      Local = 8025;  Remote = 8025; Note = "Inbox emails / alertes" },
    [pscustomobject]@{ Svc = "rabbitmq";     Local = 15672; Remote = 15672; Note = "guest / guest" }
)

function Test-PortInUse {
    param([int]$Port)
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    return [bool]$conn
}

function Test-K8sService {
    param([string]$Name, [string]$Ns)
    $null = & kubectl get svc $Name -n $Ns 2>$null
    return ($LASTEXITCODE -eq 0)
}

if (-not $Quiet) {
    Write-Host "=============================================" -ForegroundColor Cyan
    Write-Host "Port-forwards Kubernetes -> localhost"        -ForegroundColor Cyan
    Write-Host "=============================================`n" -ForegroundColor Cyan
}

$started = @()
$skipped = @()

foreach ($f in $forwards) {
    if (-not (Test-K8sService -Name $f.Svc -Ns $Namespace)) {
        Write-Host ("[SKIP] {0,-13} (svc absent du cluster)" -f $f.Svc) -ForegroundColor DarkGray
        $skipped += $f
        continue
    }

    if (Test-PortInUse -Port $f.Local) {
        Write-Host ("[SKIP] {0,-13} port {1} deja occupe localement" -f $f.Svc, $f.Local) -ForegroundColor Yellow
        $skipped += $f
        continue
    }

    $title = "pf:$($f.Svc) $($f.Local)->$($f.Remote)"
    $cmd   = "`$Host.UI.RawUI.WindowTitle = '$title'; kubectl port-forward svc/$($f.Svc) $($f.Local):$($f.Remote) -n $Namespace"
    $windowStyle = if ($ShowWindows) { "Minimized" } else { "Hidden" }

    Start-Process -FilePath "powershell.exe" `
        -ArgumentList "-NoExit","-NoLogo","-Command",$cmd `
        -WindowStyle $windowStyle | Out-Null

    $url = "http://localhost:$($f.Local)"
    $note = if ($f.Note) { "  ($($f.Note))" } else { "" }
    Write-Host ("[OK]   {0,-13} {1}{2}" -f $f.Svc, $url, $note) -ForegroundColor Green
    $started += $f
}

if (-not $Quiet) {
    Write-Host ""
    Write-Host ("Demarres : {0}   Ignores : {1}" -f $started.Count, $skipped.Count) -ForegroundColor Cyan
    if (-not $ShowWindows) {
        Write-Host "(Processus caches en arriere-plan. Utilisez -ShowWindows pour les rendre visibles.)" -ForegroundColor DarkGray
    }
    Write-Host "Lister  : Get-CimInstance Win32_Process -Filter `"Name='powershell.exe'`" | ? CommandLine -match 'pf:'" -ForegroundColor DarkGray
    Write-Host "Arret   : .\scripts\stop-port-forwards.ps1" -ForegroundColor DarkGray
}
