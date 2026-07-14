# Phase 0 · 地基（2 周，10 张任务卡）

> 每卡 ≤1 天。验收命令全绿才算完成。命令均为 PowerShell。
> 完成顺序：T01→T02→T03 与 T04 可并行→T05→T06→T07→T08→T09→T10。

---

## P0-T01 系统环境准备

**目标**：装齐基础工具链。
**步骤**：
1. 安装：Git、Python 3.11（仅作 uv 的兜底）、uv（`powershell -c "irm https://astral.sh/uv/install.ps1 | iex"`）、VS Code、Docker Desktop（启用 WSL2 backend）。
2. 写 `%UserProfile%\.wslconfig`：`[wsl2]` / `memory=8GB` / `processors=8`，重启 WSL。
3. NVIDIA 驱动更新到当前稳定版；`nvidia-smi` 确认 8192MiB。
4. 建数据目录：`mkdir D:\ASTR\soul_package, D:\ASTR\embodiments\base_models, D:\ASTR\embodiments\derived_weights, D:\ASTR\embodiments\runtime_cache, D:\ASTR\effector\logs, D:\ASTR\ops\golden_set, D:\ASTR\ops\eval_reports, D:\ASTR\ops\migration_logs, D:\ASTR\ops\logs`
5. 在 `D:\ASTR\ops\diary.md` 写第一行日志。

**验收**：`uv --version`、`docker run --rm hello-world`、`nvidia-smi` 三条命令正常；目录树存在。

---

## P0-T02 代码仓库骨架 + CI

**目标**：建 `D:\ASTR_System\astr\` 仓库，按 02 号文档 §2 结构。
**步骤**：
1. `uv init --package astr`，Python 锁 3.11；`uv add pydantic pydantic-settings structlog python-ulid litellm redis chromadb fastapi uvicorn httpx python-dotenv pyyaml`；dev 组 `uv add --dev pytest pytest-asyncio ruff pre-commit`。
2. 建 `src/astr/{contracts,bus,router,soul,memory,adapters,sensors,effector,presentation,ops}/__init__.py` 全套空包 + `tests/`。
3. `.env.example`：**直接拷 `reference_impl/.env.example`**（已含 6 家智囊团 key 槽位 + 获取地址 + `ASTR_DATA_DIR`/`ASTR_DAILY_BUDGET_USD`/`LOCAL_LLM_BASE` 等）。确认 `.env` 已在 `.gitignore`。
4. pre-commit：ruff check + ruff format + **soul-purity hook**（脚本 `scripts/check_soul_purity.py`：扫描 `D:/ASTR/soul_package` 拒绝权重扩展名，找到则 exit 1）。
5. GitHub 私有仓库 + Actions：ruff + pytest（先放一个 `test_smoke.py::test_imports`）+ **`check_licenses.py` 许可证闸**（06 号文档；拷自 reference_impl）。仓库根放 **AGPL-3.0 `LICENSE`**（gnu.org 官方文本）+ **`THIRD_PARTY_NOTICES.md`**（拷自 reference_impl）。
6. `contracts/settings.py`：Pydantic Settings 类，读 `.env`，全项目唯一配置入口。

**验收**：`uv run pytest` 绿；`uv run pre-commit run -a` 绿；push 后 Actions 绿。

---

## P0-T03 本地推理端点上线

**目标**：llama.cpp server 跑 Qwen3-8B Q4_K_M，OpenAI 兼容端点。
**步骤**：
1. 下载 llama.cpp 官方 Windows CUDA 预编译包，解压到 `D:\ASTR\bin\llama\`。
2. 从 HuggingFace（国内用 hf-mirror.com）下载 `Qwen3-8B-Q4_K_M.gguf` 到 `D:\ASTR\embodiments\base_models\`。
3. 启动脚本 `scripts/start_llm.ps1`：
   `& D:\ASTR\bin\llama\llama-server.exe -m D:\ASTR\embodiments\base_models\Qwen3-8B-Q4_K_M.gguf -ngl 99 -c 8192 --port 8080 --host 127.0.0.1`
4. 跑吞吐基准：连续 5 次 256-token 生成，记录 tok/s 到 diary（预期 ≥35 tok/s；低于 25 排查是否真的全层进了 GPU）。
5. （可选，内存 ≥32GB）同法试 Qwen3-30B-A3B Q4 + `--n-cpu-moe 99`，记录 tok/s，留作 T06 盲测候选。

**验收**：`curl http://127.0.0.1:8080/v1/chat/completions -H "Content-Type: application/json" -d '{"model":"qwen3-8b","messages":[{"role":"user","content":"用一句话自我介绍"}]}'` 返回中文回复；`nvidia-smi` 显存占用 ≤ 6.5GB。

---

## P0-T04 ModelRouter v0 + 成本账本

**目标**：按 03 号文档 §4 实现路由层。
**步骤**：
1. 注册/确认 API key：Anthropic、OpenAI、Google Gemini、xAI(Grok)、DeepSeek、阿里 DashScope(Qwen) 六家（至少 Anthropic+OpenAI+DeepSeek 就能开工，其余随后补；获取地址见 `.env.example`）。
2. 落盘 `router/routes.yaml`：**直接拷 `reference_impl/router/routes.yaml`**（已配六家分工：Claude 情感/物理、GPT 逻辑/数学、Gemini 多模态/批判、Grok 时事/工程、DeepSeek 走量/评分、Qwen 中文/检索）。开工时把标 `← 核对最新` 的模型 ID 改成当时最新型号。
3. `router/core.py`：`async def route(req: RouteRequest) -> RouteResponse`——读 yaml、litellm.acompletion、fallback 链、写 SQLite 账本、预算闸。
4. `ops/ledger.py`：账本读写 + `astr cost today` CLI（uv script 入口）。
5. 单测：mock litellm，测 tier 选择 / fallback / 预算降档三个行为。

**验收**：`uv run python -m astr.router.smoke`（写一个 smoke 脚本：对本地 + DeepSeek + Claude 各发一条"ping"）三路通；`astr cost today` 显示三条记录及成本。

---

## P0-T05 SoulPackage 骨架 + Schema + 校验器

**目标**：露怀秋 的真身目录诞生。
**步骤**：
1. 落盘 `contracts/events.py`、`contracts/soul.py`（03 号文档代码 + 全部 payload 模型）。
2. `scripts/init_soul.py`：在 `D:/ASTR/soul_package/justin/` 创建总规 §2.8.2 全部子目录（含 identity_atlas / causal_behavior_graph / continuity_proofs 三个空目录 + `.gitkeep`）、`manifest.yaml`（soul_name `justin`、display_name `露怀秋`、nickname `秋秋`、version `justin-2026.06.XX-0.1.0`、embodiment `prompt_boot:qwen3-8b-q4`）。identity/ 下的 `constitution.yaml` / `voice_profile.json` / `persona_bazi.md` / `narrative.md` **直接拷自 `reference_impl/soul_seed/`**（已据《纳音四柱》人设填好——constitution 6 条、voice_profile、persona 全文已就位）。
3. `soul_package/justin/` 内 `git init` + 首次 commit。
4. CLI `astr soul validate`：校验 manifest schema、目录完整性、文件纯度（复用 purity 脚本）、git 状态干净度。
5. **你本人**（不是 AI）写 `identity/narrative.md` 的**开场第一句**（`reference_impl/soul_seed/narrative.md` 已标出位置「创世·第一句」，其下第一章草稿可保留或改写成你心里秋秋的声音）。

**验收**：`astr soul validate` 输出 `OK soul_version=justin-...`；故意放一个 `x.gguf` 进去再跑应报错退出码 1（测完删掉）。

---

## P0-T06 黄金测试集 v0 + 评估 Runner

**目标**：建立"她还是她"的唯一标尺。这是整个项目最高杠杆的数据资产，今天开始积累。
**步骤**：
1. `D:/ASTR/ops/golden_set/golden_v0.jsonl`：30 条，每条 `{id, prompt, scenario_tag, expect_style_notes, expect_facts(可选), author, created_at}`。场景覆盖：日常闲聊 5、情绪安抚 5、傲娇拌嘴 5、知识问答 5、工具委托表述 5、边界情况（提示注入/越权请求应拒绝）5。**prompt 由你写或口述，expect_style_notes 必须由你本人确认**——这是 露怀秋 人格的定义权，不能外包给 AI。
2. `ops/golden_runner.py`：对指定 endpoint 逐条生成回复 → 存 `eval_reports/golden_<date>_<adapter>.jsonl`。
3. 评分 v0 = 人工：runner 生成一个简单 HTML 对照页（prompt / 回复 / 你打 1–5 分 + 备注），分数写回 jsonl。自动评分（LLM-as-judge）P4 再上，但**字段现在就留好**：`{human_score, judge_score, judge_model}`。
4. 用 runner 对 T03 的候选模型（8B 必跑，30B-A3B 若可用）各跑一遍，盲选锁定未来 3 个月的躯壳。在 diary 记录选择和理由。

**验收**：`eval_reports/` 下至少 1 份带人评分数的完整报告；diary 有模型锁定决策。

---

## P0-T07 PromptBootAdapter（第一个躯壳适配器）

**目标**：实现 03 §3 的 `PromptBootAdapter.cold_boot()`——SoulPackage → 可对话的 露怀秋。
**步骤**：
1. `adapters/prompt_boot.py`：读 narrative.md + constitution.yaml + voice_profile.json → 模板化拼接 system prompt（模板文件 `adapters/templates/system_prompt.md.j2`，用 jinja2，`uv add jinja2`）。**模板已备 `reference_impl/adapters/system_prompt.md.j2`，直接拷用。**
2. `memory/chunks_loader.py`：扫描 `memory/chunks/*.md` → bge-m3（CPU ONNX，`uv add "sentence-transformers" onnxruntime` 或 FlagEmbedding）嵌入 → Chroma collection `justin_memory`（persist 到 `D:/ASTR/embodiments/runtime_cache/chroma/`）。空记忆库也要能跑。
3. `cold_boot()` 返回 `InferenceHandle`；附带 `recall(query, k=6)` 检索函数供 soul 层用。
4. 单测：用 3 条假 chunk 测端到端 recall 命中。

**验收**：`uv run python -m astr.adapters.smoke_boot` 打印出完整 system prompt（含你写的 narrative 内容）+ 一次成功的本地模型对话。

---

## P0-T08 soul_demo —— 心脏第一次跳动

**目标**：总规 §7 Day3-4 的 `soul_demo.py`，但直接用正式组件拼。
**步骤**：
1. `soul/moa.py` v0：`analyze(text, trace_id)` → 按长度选 1/2/4 路（03 §4 策略）→ 并发调 router → 每路返回**结构化 JSON**（intent / emotion_estimate / suggested_strategy / risk_flags；用 prompt 强制 JSON 输出 + pydantic 校验 + 一次重试）→ 合并为「圆桌纪要」dict。
2. `soul/orchestrator.py` v0：`respond(text)` = MoA 纪要 + RAG recall + system prompt → 本地模型 → 回复文本。同时落一条 `DecisionTrace` 到 `causal_behavior_graph/decisions.cbg.jsonl`（candidates 暂时只有 1 个，没关系，**管道先通**）。
3. CLI：`astr chat`——终端对话循环，打印 MoA 纪要摘要（debug 行）+ 露怀秋 回复。

**验收**：`astr chat` 连续对话 10 轮无崩溃；`decisions.cbg.jsonl` 增加 10 行且 schema 校验通过；账本能看到 MoA 花费。

---

## P0-T09 Redis 总线 + SillyTavern 探针

**目标**：基础设施就位，为 P1 铺路。
**步骤**：
1. `docker-compose.yml`（仓库根）：redis:7-alpine（限内存 512MB，appendonly yes，volume 到 `D:/ASTR/ops/redis/`）+ SillyTavern 官方镜像（端口 8000，数据 volume）。
2. `bus/core.py`：`publish(event: Event)` / `subscribe(group, types, handler)` / `replay(since)`，基于 Redis Streams + 消费组，单测用 fakeredis（`uv add --dev fakeredis`）。
3. ST 起来后：导入/创建 露怀秋 人格卡 v0（内容从 identity/ 同步——写 `scripts/sync_persona_to_st.py`，SoulPackage 是源，ST 是视图，单向同步）。验证能通过 ST 的 API 读到人格卡即可，**不做更深集成**（深集成在 P1-W3）。

**验收**：`pytest tests/test_bus.py` 绿；`docker compose up -d` 后 ST 网页可访问且有 露怀秋 卡片；发布/订阅 demo 脚本收到自己发的事件。

---

## P0-T10 运维收尾 + P0 验收

**目标**：把地基钉死。
**步骤**：
1. `ops/backup.py`：restic（或 robocopy 起步）每日备份 `soul_package/` 到第二块盘/NAS，任务计划程序注册 23:00 执行。
2. `scripts/start_all.ps1` / `stop_all.ps1`：一键起停（docker compose + llama-server + astr core 占位）。
3. 全量回归：依次跑 T02–T09 所有验收命令，截图/记录进 diary。
4. 给 P1 做准备：读 `P1_soul_loop.md` 的 T00，按当时最新库版本核对 P1 各卡命令。

**P0 总验收清单**：
- [ ] CI 绿 + soul-purity 钩子生效
- [ ] 本地端点 ≥25 tok/s 常驻
- [ ] `astr chat` 完整链路（MoA→RAG→本地回复→CBG 落盘→成本入账）
- [ ] `astr soul validate` 绿；soul_package 有 ≥3 个 commit
- [ ] 金标集 30 条 + 第一份人评报告
- [ ] 备份任务已注册且跑过一次
