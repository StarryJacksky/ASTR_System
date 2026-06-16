# P0-T10：一键启动 ASTR 全栈（Docker 基础设施 + 本地推理端点 + astr core 占位）。
$ErrorActionPreference = "Continue"
$repo = Split-Path -Parent $PSScriptRoot

Write-Host "=== 1/3 Docker 基础设施（Redis + SillyTavern）==="
docker compose -f (Join-Path $repo "docker-compose.yml") up -d

Write-Host "=== 2/3 本地推理端点（llama-server :8080）==="
$model = "D:\ASTR\embodiments\base_models\Qwen3-8B-Q4_K_M.gguf"
$exe = "D:\ASTR\bin\llama\llama-server.exe"
if ((Test-Path $exe) -and (Test-Path $model)) {
    Start-Process powershell -ArgumentList "-NoExit","-File",(Join-Path $PSScriptRoot "start_llm.ps1")
    Write-Host "  已在新窗口启动 llama-server。"
} else {
    Write-Warning "  跳过：llama-server 或模型未就位（见 scripts\download_models.ps1 / P0-T03）。"
}

Write-Host "=== 3/4 ASTR Core 守护进程（FastAPI :8300）==="
Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$repo'; uv run --no-sync astr core"
Write-Host "  已在新窗口启动 ASTR Core。"

Write-Host "=== 4/4 看门狗 / 浸泡监控（健康巡检 + 掉线告警）==="
Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$repo'; Start-Sleep 8; uv run --no-sync astr watch"
Write-Host "  已在新窗口启动看门狗（CSV→D:\ASTR\ops\logs\health\）。"

Write-Host "`n完成。检查：docker ps；curl http://127.0.0.1:8080/v1/models；curl http://127.0.0.1:8300/v1/status"
Write-Host "浸泡抽查：uv run --no-sync astr watch --once"
