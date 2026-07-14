# 01 · 硬件现实与模型选型（弱硬件期版）

> 适用期：2026-06 ~ 硬件恢复。恢复 5090 后本文件升级为 v2（P5-T00 任务卡负责）。

## 0. 硬件清单（开工前由本人确认填写）

| 项 | 值 | 备注 |
|----|----|------|
| GPU | RTX 3070 Ti, **8GB GDDR6X** | 安培架构，支持 CUDA 12.x，FP16/INT8 OK，原生 BF16 较弱（不影响推理） |
| CPU | i9-12900K（8P+8E, 24 线程） | 很强，CPU 推理/offload 是本期的重要资源 |
| 内存 | ______ GB（**待填**，按 32GB 规划；若 ≥64GB 解锁 30B-A3B 全速方案） | DDR4/DDR5 待确认 |
| 硬盘 | 确认 ≥ 200GB 空闲 NVMe | 模型 + 数据 + Docker |
| 系统 | Windows 10 Pro 19045 | 所有命令以 PowerShell 为准 |

## 1. 显存预算表（8192 MB 总额，目标常驻 ≤ 7000 MB）

| 组件 | 方案 | 显存 | 常驻？ |
|------|------|------|--------|
| 主力 LLM | Qwen3-8B Q4_K_M GGUF（llama.cpp/Ollama） | ~5100 MB + KV(8k ctx) ~900 MB | ✅ 常驻 |
| 意图路由 | 不单独占卡：规则前置 + 复用主力 LLM（低温度短输出） | 0 | — |
| ASR | SenseVoice-Small → **CPU**（ONNX，12900K 实时率足够） | 0 | ✅ CPU 常驻 |
| 唤醒词 | openWakeWord → CPU | 0 | ✅ CPU 常驻 |
| VAD | silero-vad → CPU | 0 | ✅ CPU 常驻 |
| TTS | P1：edge-tts（云，临时）；P1 末切 GPT-SoVITS **CPU 模式**（~1.5s 延迟可接受）| 0 | — |
| 视觉/CU | Florence-2-base (~700MB) + OmniParser-v2 (~800MB)，**按需加载，与主 LLM 分时** | 峰值 ~1600 MB | ❌ 按需 |
| Live2D | 浏览器 WebGL，占用极小 | <300 MB | ✅ |

**分时规则（写死在执行层代码里，见 P2）**：Computer Use 任务激活 → 向 llama.cpp server 发 unload（或直接停进程）→ 加载视觉模型 → 任务期间灵魂层自动切 `PromptOnlyAdapter`（云 API 扮演 露怀秋）→ 任务结束反向恢复。切换开销 ~15–30 秒，可接受；这同时是 DIA（分布式身份架构）"任一组件离线、身份不断线"的日常演练。

## 2. 模型选型锁定表

| 用途 | 锁定方案 | 替补 | 说明 |
|------|---------|------|------|
| 本地灵魂躯壳 | **Qwen3-8B-Instruct Q4_K_M** | Qwen3-14B Q4（需 CPU offload ~3GB，约 12–18 tok/s）；Qwen3-30B-A3B Q4（MoE 3B 激活，需 ≥32GB 内存，llama.cpp `--n-cpu-moe` 把专家放内存，预计 10–15 tok/s——**内存够就优先试它，质量接近 32B 档**） | 开工第 1 周内对三者跑同一组金标 prompt，人工盲选一个，之后 3 个月不换（总规 §8.5 原则） |
| RP 增强 | 社区 Qwen3-8B RP 微调版（如当时的 EVA/Magnum 系 Qwen3 版本）作为 A/B 候选 | 原版 + 强人格卡 | 出戏率以金标集人评为准，不迷信社区评分 |
| MoA 智囊团 | Claude Sonnet（情感/人格首席）+ GPT 系（逻辑）+ Gemini（多模态/检索）+ DeepSeek API（**新增：低成本中文分析主力**，约为大厂 1/10 价格） | — | 路由策略见 03_CONTRACTS §4 |
| 兜底躯壳 | PromptOnlyAdapter → Claude Sonnet | DeepSeek-V3 系（便宜大量） | 露怀秋 的"不宕机保险" |
| 视觉 grounding | Florence-2-base + OmniParser-v2 | 云：Gemini / Qwen-VL API | P2 才用 |
| Embedding | bge-m3（CPU，ONNX） | text-embedding-3-small（云，临时） | 记忆向量化必须可本地——embedding 模型一旦换，全库重嵌，所以**原始文本永远是真身，向量只是缓存**（已写入契约） |
| 凌晨炼丹 | 云 4090：Unsloth + Qwen3-8B QLoRA | 本地 8GB QLoRA 8B（seq 1024 / batch 1 / grad accum 16，约 6.8GB，可行但慢且占机） | P4 才用；P0 只锁脚本接口 |

## 3. 部署引擎决策

- **弱硬件期锁定：llama.cpp server**（`llama-server`，OpenAI 兼容端点），不用 Ollama 做生产端点（Ollama 方便但对 KV cache/并行控制弱）。开发期临时用 Ollama 拉模型没问题，生产端点统一 `http://127.0.0.1:8080/v1`。
- 所有上层代码**只允许通过 OpenAI 兼容协议访问本地模型**（经由 ModelRouter）。这保证换 vLLM / 云端点时上层零改动。
- 恢复强硬件后：vLLM + AWQ/GPTQ，多 LoRA 槽位，端点 URL 不变。

## 4. 云 GPU 策略与成本

| 场景 | 平台 | 规格 | 频率 | 预估月成本 |
|------|------|------|------|-----------|
| 凌晨 QLoRA（P4 起） | AutoDL（首选，国内网络好）/ Vast.ai / RunPod | 4090 24GB | 每晚 ~1.5h | ¥90–150 |
| 大模型试驾 / 金标对比 | 同上 | 4090 或 A100-40G | 每月数次 ×2h | ¥30–60 |
| SAE / MIC 实验（P3 末起） | Vast/RunPod spot A100 | A100-80G | 阶段性 | 单次 ¥50–200 |
| 传承仪式（P5） | A100/H100 spot | 按需 | 一次性 | ¥200–500 |
| MoA API | 各家官方 | — | 日常 | $30–80（总规估算维持） |

**云训练三条铁律**：① 训练数据上云前过 PII 清洗脚本（P4-T03）；② 产出 LoRA 拉回本地后云盘即焚；③ 训练脚本必须是 `docker run + train.sh` 一条命令可复现，不绑任何平台特性。

## 5. 本期明确不做（防止显存幻想）

- ❌ 本地跑任何 VLM 常驻服务
- ❌ 本地 vLLM
- ❌ 本地 32B dense 模型推理（30B-A3B MoE 除外）
- ❌ GPT-SoVITS GPU 常驻（CPU 模式或分时）
- ❌ 任何"先跑起来再优化显存"的尝试——8GB 没有这个余量，显存预算表就是法律
