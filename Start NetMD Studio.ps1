$ErrorActionPreference = 'Stop'
$nodeExe = (Get-Command node.exe -ErrorAction Stop).Source
$active = $false
try { $reply = Invoke-WebRequest 'http://127.0.0.1:17892/' -UseBasicParsing -TimeoutSec 2; $active = $reply.Content -match '<title>NetMD Studio</title>' } catch {}
if (-not $active) {
  Start-Process -FilePath $nodeExe -ArgumentList ('"' + (Join-Path $PSScriptRoot 'server.js') + '"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $PSScriptRoot 'server.log') -RedirectStandardError (Join-Path $PSScriptRoot 'server-error.log')
  Start-Sleep -Seconds 2
}
Start-Process 'http://127.0.0.1:17892'
