# Token-Free Gateway auto-start (fork in auto-ai-article/third_party/token-free-gateway)
# Probe port 3456, start daemon if not listening. Idempotent.
# Called by scheduled task ArticleSite-AIGateway (logon + daily 07:50) and
# scripts/scheduled-generate.mjs self-heal (executor localGatewayStartCommand).
# $exe resolves relative to this script's directory, so the whole folder can be moved.
$exe = Join-Path $PSScriptRoot 'token-free-gateway.exe'
$listener = Get-NetTCPConnection -LocalPort 3456 -State Listen -ErrorAction SilentlyContinue
if ($listener) {
  Write-Output "[gateway] already running on :3456"
} else {
  Write-Output "[gateway] starting daemon..."
  Start-Process -FilePath $exe -ArgumentList 'start' -WindowStyle Hidden
  Start-Sleep -Seconds 8
  if (Get-NetTCPConnection -LocalPort 3456 -State Listen -ErrorAction SilentlyContinue) {
    Write-Output "[gateway] started OK"
  } else {
    Write-Output "[gateway] start issued, port not yet listening (will retry next trigger)"
  }
}
