# Arrete tous les port-forwards lances par start-port-forwards.ps1.
# Recherche les fenetres PowerShell dont le titre commence par "pf:" et les ferme.

$ErrorActionPreference = "SilentlyContinue"

$pfProcesses = Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
    Where-Object { $_.CommandLine -match "pf:[a-z\-]+" -and $_.CommandLine -match "kubectl port-forward" }

if (-not $pfProcesses) {
    Write-Host "Aucun port-forward actif trouve." -ForegroundColor DarkGray
    return
}

foreach ($p in $pfProcesses) {
    if ($p.CommandLine -match "pf:([a-z\-]+)\s") {
        $svc = $matches[1]
    } else {
        $svc = "?"
    }
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    Write-Host ("[STOP] pf:{0} (PID {1})" -f $svc, $p.ProcessId) -ForegroundColor Yellow
}

# Au cas ou des kubectl orphelins resteraient
Get-Process kubectl -ErrorAction SilentlyContinue | ForEach-Object {
    $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)").CommandLine
    if ($cmd -match "port-forward") {
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
        Write-Host ("[STOP] kubectl PID {0}" -f $_.Id) -ForegroundColor Yellow
    }
}
