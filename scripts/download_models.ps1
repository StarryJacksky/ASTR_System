# P0-T03：下载 llama.cpp（Windows CUDA 预编译）+ Qwen3-8B-Q4_K_M.gguf。
# 国内网络优先用 hf-mirror.com。整体约 ~5GB，按需执行（脚本默认只打印计划，加 -Run 才真正下载）。
#
#   powershell -File scripts\download_models.ps1            # 只打印将做什么
#   powershell -File scripts\download_models.ps1 -Run       # 真正下载

param(
    [switch]$Run,
    [string]$LlamaUrl = "",   # llama.cpp release 的 win-cuda zip 直链（开工核对最新 release）
    [string]$HfEndpoint = "https://hf-mirror.com",
    [string]$GgufRepo = "Qwen/Qwen3-8B-GGUF",
    [string]$GgufFile = "Qwen3-8B-Q4_K_M.gguf"
)

$binDir = "D:\ASTR\bin\llama"
$modelDir = "D:\ASTR\embodiments\base_models"

Write-Host "=== 计划 ==="
Write-Host "1) llama.cpp CUDA 预编译 → $binDir"
Write-Host "   下载地址（核对最新）: https://github.com/ggml-org/llama.cpp/releases  选 llama-bXXXX-bin-win-cuda-x64.zip"
Write-Host "2) GGUF 模型 → $modelDir\$GgufFile（自 $HfEndpoint/$GgufRepo）"
if (-not $Run) {
    Write-Host "`n(预览模式) 加 -Run 真正执行。或手动下载后用 scripts\start_llm.ps1 启动。"
    exit 0
}

New-Item -ItemType Directory -Force -Path $binDir, $modelDir | Out-Null

# 1) llama.cpp
if ($LlamaUrl -ne "") {
    $zip = Join-Path $env:TEMP "llama-cuda.zip"
    Write-Host "下载 llama.cpp ..."
    Invoke-WebRequest -Uri $LlamaUrl -OutFile $zip
    Expand-Archive -Path $zip -DestinationPath $binDir -Force
} else {
    Write-Warning "未提供 -LlamaUrl，跳过 llama.cpp 下载（请手动放到 $binDir）。"
}

# 2) GGUF（用 huggingface_hub，走镜像）
$env:HF_ENDPOINT = $HfEndpoint
Write-Host "下载 $GgufFile（经 $HfEndpoint）..."
uv run python -c "from huggingface_hub import hf_hub_download; hf_hub_download(repo_id='$GgufRepo', filename='$GgufFile', local_dir=r'$modelDir')"
Write-Host "完成。用 scripts\start_llm.ps1 启动端点。"
