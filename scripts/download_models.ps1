# P0-T03：下载 llama.cpp（Windows CUDA 预编译）+ Qwen3-8B-Q4_K_M.gguf。
# 实测可用源（2026-06，本机网络）：
#   - llama.cpp：GitHub releases（ggml-org/llama.cpp）b9631，CUDA 12.4（驱动 560.94 / CUDA 12.6 上限，12.4 兼容）。
#   - GGUF：魔搭 ModelScope（国内直连稳；hf-mirror 的 /resolve 会 308 跳回 huggingface.co 且 CDN 在本网 schannel 握手失败）。
# 整体约 ~5.6GB。默认只打印计划，加 -Run 才真正下载。
#
#   powershell -File scripts\download_models.ps1            # 预览
#   powershell -File scripts\download_models.ps1 -Run       # 真正下载

param(
    [switch]$Run,
    [string]$LlamaTag = "b9631",
    [string]$Cuda = "12.4",
    [string]$MsRepo = "Qwen/Qwen3-8B-GGUF",
    [string]$GgufFile = "Qwen3-8B-Q4_K_M.gguf"
)

$binDir = "D:\ASTR\bin\llama"
$modelDir = "D:\ASTR\embodiments\base_models"
$ghBase = "https://github.com/ggml-org/llama.cpp/releases/download/$LlamaTag"
$mainZip = "llama-$LlamaTag-bin-win-cuda-$Cuda-x64.zip"
$cudartZip = "cudart-llama-bin-win-cuda-$Cuda-x64.zip"
$msUrl = "https://modelscope.cn/models/$MsRepo/resolve/master/$GgufFile"

Write-Host "=== 计划 ==="
Write-Host "1) llama.cpp $LlamaTag (CUDA $Cuda) → $binDir"
Write-Host "     $ghBase/$mainZip"
Write-Host "     $ghBase/$cudartZip"
Write-Host "2) GGUF → $modelDir\$GgufFile  （自魔搭 $msUrl）"
if (-not $Run) {
    Write-Host "`n(预览模式) 加 -Run 真正执行。"
    exit 0
}

New-Item -ItemType Directory -Force -Path $binDir, $modelDir | Out-Null

# 1) llama.cpp 主程序 + CUDA 运行时（两个都要，解压到同目录）
Write-Host "下载 llama.cpp 主程序 ..."
curl.exe -L --ssl-no-revoke "$ghBase/$mainZip" -o "$env:TEMP\llama_cuda.zip"
curl.exe -L --ssl-no-revoke "$ghBase/$cudartZip" -o "$env:TEMP\cudart.zip"
Expand-Archive "$env:TEMP\llama_cuda.zip" -DestinationPath $binDir -Force
Expand-Archive "$env:TEMP\cudart.zip" -DestinationPath $binDir -Force
if (-not (Test-Path "$binDir\llama-server.exe")) { Write-Error "llama-server.exe 解压后未找到"; exit 1 }

# 2) GGUF（魔搭，断点续传）
Write-Host "下载 $GgufFile（魔搭，~5GB，可中断后重跑续传）..."
curl.exe -L -C - --ssl-no-revoke --retry 5 --retry-delay 3 -o "$modelDir\$GgufFile" $msUrl

Write-Host "完成。用 scripts\start_llm.ps1 启动端点。"
