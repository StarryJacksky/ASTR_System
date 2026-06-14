# P0-T10：一键停止 ASTR 全栈。
$ErrorActionPreference = "Continue"
$repo = Split-Path -Parent $PSScriptRoot

Write-Host "=== 停止 llama-server ==="
Get-Process llama-server -ErrorAction SilentlyContinue | Stop-Process -Force
Write-Host "  done."

Write-Host "=== 停止 Docker 基础设施 ==="
docker compose -f (Join-Path $repo "docker-compose.yml") stop

Write-Host "`n已停止。（数据卷与容器保留；彻底清理用 docker compose down）"
