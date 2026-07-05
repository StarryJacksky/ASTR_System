# P2.5：启动本地 UI-TARS-1.5-7B（端到端 GUI grounding，OpenAI 兼容 :8081/v1）。
# 显存：Q4 权重 ~4.7GB + mmproj f16 ~1.4GB + KV ≈ 7GB —— 与 qwen3-8b 不能同跑，
# CU 期间由 vram_broker 停 qwen 再起本服务（scripts/cu_milestone.py --local 已包）。
param(
    [string]$Model = "D:\ASTR\embodiments\vision\ui_tars\UI-TARS-1.5-7B-q4_k_m.gguf",
    [string]$MMProj = "D:\ASTR\embodiments\vision\ui_tars\UI-TARS-1.5-7B-f16.mmproj",
    [int]$Ctx = 8192,    # 单步：一张降采样截图 ~1.3k 视觉 token + 指令/履历，8k 足够
    [int]$Port = 8081,
    [int]$NGL = 99
)

$exe = "D:\ASTR\bin\llama\llama-server.exe"
foreach ($f in @($exe, $Model, $MMProj)) {
    if (-not (Test-Path $f)) { Write-Error "未找到 $f"; exit 1 }
}

# --image-min-tokens 1024：llama.cpp 明确警告 Qwen-VL 系 grounding 任务低于此值坐标精度劣化
& $exe -m $Model --mmproj $MMProj -c $Ctx --port $Port -ngl $NGL --host 127.0.0.1 `
    --alias ui-tars --no-warmup --image-min-tokens 1024 -np 1
