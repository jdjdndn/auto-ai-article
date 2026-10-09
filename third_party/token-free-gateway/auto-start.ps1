# Token-Free Gateway auto-start (fork in auto-ai-article/third_party/token-free-gateway)
# Probe port 3456, start daemon if not listening. Idempotent.
# Called by scheduled task ArticleSite-AIGateway (logon + daily 07:50) and
# scripts/scheduled-generate.mjs self-heal (executor localGatewayStartCommand).
# 用 bun index.ts 启动（exe 打包时硬编码了旧路径 E:\code\token-free-gateway-src，已不存在）
$listener = Get-NetTCPConnection -LocalPort 3456 -State Listen -ErrorAction SilentlyContinue
if ($listener) {
  Write-Output "[gateway] already running on :3456"
} else {
  Write-Output "[gateway] starting daemon (bun index.ts)..."
  Start-Process -FilePath "bun" -ArgumentList "index.ts" -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
  Start-Sleep -Seconds 8
  if (Get-NetTCPConnection -LocalPort 3456 -State Listen -ErrorAction SilentlyContinue) {
    Write-Output "[gateway] started OK"
  } else {
    Write-Output "[gateway] start issued, port not yet listening (will retry next trigger)"
  }
}
