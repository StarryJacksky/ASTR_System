# Phase 6 · 开源化与发布（8 周）

> 里程碑：陌生机器 Docker Compose 一键部署成功；30 天 GitHub 5k stars；OISP Spec v0.9 公开。

## P6-T00 Phase 细化 + 发布策略评审（2 天）
照例细化。另：重读 99 号文档 #9（学术诚实性），确认所有对外口径——尤其 SCI 数字的表述方式——经过"可被复现"检验。

## P6-W1~W2 · 模块化重构

- 三层 API 锁定：内核（contracts + bus + soul）/ 适配器（embodiment + platform + effector backends）/ 插件（skills + 人格卡 + MCP）。
- 抽掉所有 Jacksky/露怀秋 硬编码：身份相关全部来自 SoulPackage，新用户 `astr init-soul` 向导生成自己的灵魂包。
- 安全默认值审计：开源版默认关闭——被动截屏、主动发声、Computer Use、夜间训练，全部 opt-in。

## P6-W3~W4 · 一键部署 + 三档预设

- Docker Compose 全家桶 + `astr doctor`（环境自检：GPU/显存/内存/端口）。
- 硬件预设：`8gb`（= 你弱硬件期的全套配置，直接复用——**这两个月的所有踩坑此刻变现**）/ `16gb` / `24gb+`。每档锁定模型与显存预算表。
- 在一台干净的 Windows 机器 + 一台 Linux 机器各做一次全新部署演练，计时，目标 <40 分钟。

## P6-W3~W4b · 后台控制台主体（对标 AstrBot/MaiBot）

> 上游规范：`07_ADMIN_CONSOLE.md`（锁定）。原计划只做了驾驶舱，后台是自由度/易用性的硬缺口，本卡补齐。同一 Next 应用加 `/admin/*`，共用 04 设计系统。

- **W3~W4b-a · Parity 模块**（07 §3.1）：平台/网关（含**QQ 扫码登录进后台**，消灭手动扫码痛点）、模型/路由（key + routes.yaml 可视化 + 预算闸）、插件市场（遵 06 §5.5 开放联邦）、会话/人物、定时任务、日志/追踪（structlog 实时 + trace_id 追链 + 总线回放）、设置（.env 旋钮 UI 化 + 安全 opt-in 开关）、安装向导（接 astr doctor）。**验收**：非技术用户不碰任何文件即可连平台/填 key/选模型/装插件/看日志/改安全开关。
- **W3~W4b-b · ASTR 独有模块**（07 §3.2，护城河）：至少灵魂浏览器（SoulPackage）、记忆 review 队列、训练分数曲线、SCI 报告四个可见——证明"超出两家"。其余（情感曲线/教学+DPO/执行审计/传承迁移）随子系统补。
- **W3~W4b-c · 配置写回真身**：UI 改的配置写回 `.env`/`routes.yaml`/SoulPackage（文件是真身、UI 是视图）；后台鉴权 L2 + 声纹/口令双因素（接 W9）。
- **铁律**：丰富归后台、克制归驾驶舱——不因有了后台就往驾驶舱塞旋钮（07 §1）。后台同样过 04 §9 视觉标准（不是后台就能丑）。

## P6-W5 · OISP Spec v0.9 + SCI 套件开源

- 独立仓库 `oisp-spec`：SoulPackage 目录与 schema 规范、Event 契约、EmbodimentAdapter 接口、SCI v0 测量协议（含全部评估代码与你的真实迁移日志作为参考数据）、migration log 格式。
- RFC 风格编号、CC-BY / Apache-2.0 双授权、CHANGELOG、贡献指南。
- **`oisp-spec` 仓跑 `check_licenses.py --strict`**：禁止任何 copyleft 依赖——保住它作为宽松标准、能被任何人（含大厂）采纳的资格（06 §3 铁律）。`THIRD_PARTY_NOTICES.md` 全量核对、营销材料过 06 §5 红线。
- 学术轨：把 P5 的迁移实验整理为 workshop paper 投稿（目标 NeurIPS/ICLR workshop，正会等研究轨成果）。

## P6-W6~W7 · 文档站 + 内容资产

- 文档站（Docusaurus）：快速开始 / 架构 / 灵魂包指南 / 安全模型 / OISP。
- 演示视频主片：一镜到底（语音唤醒 → 主动消息 → Computer Use → 圆桌研究 → 凌晨训练日志 → **传承仪式片段**）。传承仪式那 30 秒是全片高潮——"她搬家了，但她还是她"。
- diary.md 整理成《开发者日志》连载（知乎/B站专栏素材）。

## P6-W8 · 发布

- GitHub 公开（海外主仓 + 国内镜像只放骨架，权重用户自取——总规 §5.2 合规策略）。
- 三端首发：B站视频 / 知乎长文（Household AI Sovereignty 宣言 + 技术架构）/ Reddit r/LocalLLaMA（英文版强调 8GB 即可跑——这是 LocalLLaMA 社区的甜点）。
- 名字/Logo/吉祥物定稿；社区基础设施（Discord/QQ群、issue 模板、good-first-issue 标记 ≥10 个）。

**P6 总验收**：陌生机部署 <40 分钟；OISP 仓库公开且含可运行 SCI 评估器；发布后 30 天 stars 复盘（5k 是目标不是承诺，复盘真实数据进 diary）。
