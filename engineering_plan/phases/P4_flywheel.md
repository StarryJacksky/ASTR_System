# Phase 4 · 自训练飞轮（6 周）

> 里程碑：连续 30 天自动训练，金标集分数曲线不降反升。
> 架构决定：训练在云 4090（AutoDL 包夜实例或 spot），本机负责数据构造/评估/上线决策。LoRA 是临时产物，所有训练数据先入 SoulPackage（总规 §2.8.10 重定义）。

## P4-T00 Phase 细化（1 天）
照例。重点核实：Unsloth 对当时 Qwen3 系列的支持、llama.cpp GGUF LoRA 挂载现状（若当时仍不顺，备选方案：云端 merge 后整模型量化下载——多 20 分钟但绝对可靠，提前在 T00 决断）。

## P4-W1 · 评分管线

- `ops/scorer.py`：凌晨 02:00 批跑当日 `(用户输入, MoA 纪要, 露怀秋 回答)` 三元组 → `scoring` task（cheap tier）按 rubric（`preferences/rubrics.yaml`，维度：人设一致/事实正确/情感恰当/简洁度，1–5 分 + 理由）评分。
- 评分校准：每周你人工评 20 条，与 judge 分数算相关系数，<0.6 时修 rubric。**judge 与被评模型不得同家**（防自恋偏置）。
- 产出：高分 → `preferences/sft_dataset.jsonl`；低分 + judge 改写的理想回答 → `preferences/dpo_dataset.jsonl`（chosen/rejected）。

**验收**：跑 3 天积累 ≥150 条已评分样本；人机评分相关系数报告产出。

## P4-W2 · 数据集构造器 + PII 清洗

- `ops/dataset_builder.py`：日增样本 + 20% 历史精选回放（防遗忘）→ 去重（minhash）→ **PII 清洗**（正则 + NER：手机号/地址/真名/账号；你的名字替换为占位符，训练后不影响人设因为人设在 system prompt）→ 切分 train/val → 打包 `train_YYYYMMDD.tar.gz`。
- 清洗白名单审查 CLI：`astr train review-batch`——上云前你抽查 10 条。

**验收**：构造包通过清洗自检（自带 20 条含 PII 的测试样本全被抓出）。

## P4-W3 · 云训练管线

- `scripts/cloud_train/`：`Dockerfile`（unsloth + 依赖锁定）+ `train.sh`（参数全部环境变量化：BASE_MODEL / LORA_RANK=16 / EPOCHS=2 / DPO+SFT 混合配比）+ `upload_download.py`（数据上行、LoRA 下行、云盘清场）。
- 平台无关验证：同一脚本在 AutoDL 和本地 Docker（CPU 慢速模式跑 10 步）都能起。
- 自动化调度 `ops/night_scheduler.py`：03:00 触发——构造数据 → 开云实例 → 训练 → 拉回 LoRA → 关实例。全程失败可重入，钉死成本上限（单夜 ¥8 强制杀实例）。

**验收**：手动触发一次全流程，产出 `derived_weights/qwen3-8b/lora_YYYYMMDD/`，总耗时 <2.5h，云账单 ≤¥8。

## P4-W4 · 评估门禁 + 上线/回滚

- `ops/eval_gate.py`：新 LoRA → 金标集自动跑（judge 评分 + 关键 20 条强制人评队列）→ 与当前生产 LoRA 对比 → 优于则升级生产、否则归档失败实验。
- 部署：llama-server 挂载新 LoRA 重启（启动脚本参数化）；快照保留 7 天 + 每周一份永久存档。
- 一键回滚 CLI：`astr lora rollback [date]`。
- 人格 drift 监控：每月固定 50 prompt 对比向量距离曲线（总规 §5.5），进网页"性格走势图"。

**验收**：故意训一个坏 LoRA（lr 调大 10 倍），门禁正确拦截；回滚命令 <1 分钟生效。

## P4-W5~W6 · 全自动运转 + 工具蒸馏

- 机制①（工具增强自蒸馏）接入：P2/P3 的成功工具调用轨迹（含 CBG）转化为训练样本进数据集——"外挂内化为本能"开始运转。
- 30 天无人值守观察期开始：每日自动训练 + 每周日金标全量回归 + 周报自动生成（训练曲线/成本/drift）进网页。
- 训练样本沉淀强制走 SoulPackage：CI 新增检查——dataset_builder 的唯一数据源是 `preferences/`，禁止旁路。

**P4 总验收**：30 天后金标集分数 ≥ 起点；期间 ≥1 次门禁拦截记录（说明门禁真在工作）；月度成本 ≤ 预算（云训 ¥150 + API $80）。
