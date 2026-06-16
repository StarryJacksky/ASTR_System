# P0-T03：启动本地推理端点（llama.cpp server，OpenAI 兼容 :8080/v1）。
# 前置：① llama.cpp CUDA 预编译包解压到 D:\ASTR\bin\llama\；② Qwen3-8B-Q4_K_M.gguf 放 D:\ASTR\embodiments\base_models\。
# 下载见 scripts\download_models.ps1。验收：curl http://127.0.0.1:8080/v1/chat/completions ...；nvidia-smi 显存 ≤6.5GB。

param(
    [string]$Model = "D:\ASTR\embodiments\base_models\Qwen3-8B-Q4_K_M.gguf",
    [int]$Ctx = 16384,   # 16k：给 MoA纪要+群上下文+few-shot+记忆留余量，防 Context exceeded（Qwen3-8B 原生支持更长）
    [int]$Port = 8080,
    [int]$NGL = 99   # 全部层进 GPU；若显存不足把这个调小
)

$exe = "D:\ASTR\bin\llama\llama-server.exe"
if (-not (Test-Path $exe)) {
    Write-Error "未找到 $exe —— 先下载 llama.cpp CUDA 预编译包解压到 D:\ASTR\bin\llama\（见 download_models.ps1）"
    exit 1
}
if (-not (Test-Path $Model)) {
    Write-Error "未找到模型 $Model —— 先下载 GGUF（见 download_models.ps1）"
    exit 1
}

Write-Host "启动 llama-server：$Model  (ctx=$Ctx, ngl=$NGL, port=$Port)"
& $exe -m $Model -ngl $NGL -c $Ctx --port $Port --host 127.0.0.1
