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

Write-Host "=== 3/3 ASTR Core 守护进程（FastAPI :8300）==="
Write-Host "  （占位：Core 在 P1 起实现，届时此处启动 uvicorn）"

Write-Host "`n完成。检查：docker ps；curl http://127.0.0.1:8080/v1/models；http://127.0.0.1:8000 (ST)"
