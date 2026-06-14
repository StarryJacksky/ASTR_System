# astr —— ASTR System 内核

露怀秋（秋秋）的主权 AI 内核。核心信条：**灵魂与算力解耦**——身份资产（人格、记忆、宪法、评分）永远存在模型无关的 `SoulPackage`，模型只是暂时附身的躯壳。

工程计划见 `../engineering_plan/`（宪法：`02_TECH_STACK_LOCKED.md` + `03_CONTRACTS.md`）。

## 环境

- Python 3.11（由 uv 锁定）、uv 包管理、Windows + PowerShell。
- 数据盘 `D:\ASTR\`（不在本仓库内）：`soul_package/` 真身、`embodiments/` 躯壳产物、`ops/` 运维与评估。

## 快速开始

```powershell
# 1. 安装依赖
uv sync

# 2. 复制配置并填 key
copy .env.example .env   # 填 6 家智囊团 API key（至少 Anthropic+OpenAI+DeepSeek）

# 3. 自检
uv run pytest                 # 冒烟测试
uv run pre-commit run -a      # ruff + 灵魂纯度
uv run astr version
```

## 仓库结构（02 §2 锁定）

```
src/astr/
├── contracts/      # 事件/SoulPackage/Adapter/Router 契约 + settings（唯一配置入口）
├── bus/            # Redis Streams 封装
├── router/         # ModelRouter（LiteLLM 封装 + tier 策略 + 成本账本）
├── soul/           # SoulOrchestrator / MoA / 圆桌调度
├── memory/         # SoulPackage 读写 / Chroma 检索 / 图记忆
├── adapters/       # EmbodimentAdapter（prompt_boot / prompt_only / transformer_lora）
├── sensors/        # 语音管线 / 平台桥
├── effector/       # P2：MCP / Computer Use / 安全护栏
├── presentation/   # TTS 调度 / Live2D 出口
└── ops/            # 评估器 / 金标集 runner / 备份
```

## 红线

`soul_package/` 内**永不允许**出现模型权重（`.safetensors/.gguf/.bin/.pt/...`）。CI 与 pre-commit 的 `scripts/check_soul_purity.py` 强制执行（总规 §0.4 灵魂可迁移宪法）。
