# 06 · 许可证与合规（锁定）

> 版本：v1.0 工程稿 · 编制日期：2026-06-15
> 上游：总规 §5.2（法律/合规）、§0.5（主权立场）、§0.6（OISP 标准化）
> 地位：与 02/03 同级的合规宪法。任何引入新依赖、改许可证、对外发版的动作，以此为准。
> ⚠️ 编者非律师。本文件是工程级合规基线，不是法律意见；商业化或正式发版前须经懂开源的律师复核（见 §8）。

---

## 0. 一句话结论（TL;DR）

1. ASTR 三根支柱（AstrBot / SillyTavern / MaiBot）**全是 copyleft**，所以 **ASTR 应用整体 = AGPL-3.0**。这和 §0.5 家庭主权立场天然一致，不是负担。
2. 把**真正原创的内核当"规范+数据"**（SoulPackage 格式、Event 契约、EmbodimentAdapter 接口、SCI 协议、OISP）放进**独立 `oisp-spec` 仓库，用 Apache-2.0 / CC-BY**——这样它能成为连大厂都敢接的跨厂标准（AGPL 的标准没人敢碰）。
3. **MaiBot 不拷代码，clean-room 重写**情感状态机（绕开 GPL + 其 EULA）。
4. **不在仓库里附任何模型权重**（许可各异，用户自取）。
5. 桥接插件依赖 AstrBot(AGPL) → 它是 AGPL，**正大光明发到插件市场**（义务 + 战略双赢）。
6. **开源生态公民原则**（§5.5）：兼容三家插件 / 自建插件市场，姿态必须是"好公民/上层编排器"——署名+回上游、复用不取代、市场开放联邦、定位指回上游。这条是 ASTR 不伤社区的**硬约束**，不是道德附加。

---

## 1. 依赖许可证清单

✅ = 已核实到源文件/官方仓库；⚠️ = 开工时按当时版本核对（编者未逐一确认，勿当定论）。

| 依赖 | 角色 | 许可证 | 核实 | 传染性 / 注意 |
|------|------|--------|:---:|---------------|
| AstrBot | 中枢躯干 | **AGPL-3.0** | ✅ 本地 `AstrBot/LICENSE` | 最强：网络使用即触发源码公开 |
| SillyTavern | 海马体后端 | **AGPL-3.0** | ✅ [官方](https://github.com/SillyTavern/SillyTavern/blob/release/LICENSE) | 同上；仅经 REST 调用=手臂距离（§3） |
| MaiBot | 情感状态机 | **GPL-3.0 + 自定义 EULA** | ✅ 本地 `MaiBot/LICENSE`+`EULA.md` | EULA 另含：不鼓励商用、披露 AI 身份、遥测 → **建议重写不拷**（§4.1）|
| GPT-SoVITS | TTS 克隆 | MIT | ✅ [官方](https://github.com/RVC-Boss/GPT-SoVITS/blob/main/LICENSE) | 无；署名即可 |
| vLLM | 推理（强机期）| Apache-2.0 | ⚠️ | 无 |
| llama.cpp | 推理（弱机期）| MIT | ⚠️ | 无 |
| Qwen3 权重 | 本地灵魂躯壳 | 多为 Apache-2.0 | ⚠️ **按尺寸核对** | 部分历史尺寸走 Tongyi 协议，非纯 Apache |
| 社区无审查 RP 微调 | 灵魂增强 | 各异，常 **cc-by-nc** 或不明 | ⚠️ | 商用/分发风险高 → 不入仓 |
| Florence-2 / OmniParser-v2 | 视觉 grounding（P2）| 代码 MIT；权重另有条款 | ⚠️ | OmniParser 权重许可单独核对 |
| openWakeWord / silero-vad / SenseVoice / bge-m3 | 感官/嵌入 | 多为 Apache-2.0 / MIT | ⚠️ | 逐个核对，多数宽松 |
| Live2D Cubism SDK | 皮囊 | **专有**（营收阈值下免费）| ⚠️ | 不可改、不可重分发 SDK；商用或超阈值需单独授权 |
| LiteLLM / Redis / Chroma / FastAPI / Next.js / Framer Motion 等基建 | — | 多为 MIT / Apache-2.0 / BSD | ⚠️ | 宽松，`check_licenses.py` 兜底扫描 |
| OpenClaw | Skill 兼容（P2 调研）| ⚠️ **未核实** | ⚠️ | 许可+商标都要核对；营销措辞见 §5 |

---

## 2. ASTR 自身许可证：AGPL-3.0

**决定**：ASTR 应用主仓库采用 **AGPL-3.0**。

**为什么不是别的**：AstrBot 是躯干、AGPL，任何把它纳入的衍生/组合作品在通过网络提供服务时都须以 AGPL 提供完整对应源码。SillyTavern 同。现实上 ASTR-the-app 没有合法的"更宽松"选项。

**后果（接受它）**：① 不能做闭源商业分叉；② 任何能通过网络用到你部署的服务的人，有权索取完整对应源码；③ 必须完整保留上游版权与许可声明。

**为什么对你是顺风**：copyleft 正是"数字公地不被圈占"的法律工具，和 §0.5「不被任何公司收回」同向。AGPL 让任何人都无法把 ASTR 闭源化据为己有——这是立场，不只是合规。

---

## 3. 保护原创王冠：手臂距离 + 双仓双许可

AGPL 的传染只通过**代码层耦合**（import/链接/同进程衍生）发生，不通过**进程间通信**（REST/事件总线/独立进程）发生*（此为社区通行理解，灰区见 §8）*。你的架构本就这么设计，正好把原创 IP 和 AGPL 隔开：

```
仓库 A：ASTR 应用（AGPL-3.0）
  src/astr/*（kernel/soul/adapters/...）、webapp/、桥接插件
  ├─ 经 REST 调 SillyTavern（手臂距离，不链接 ST 代码）
  └─ AstrBot 经 HTTP POST /v1/ingest 调 astr core（AstrBot 在它自己进程里）

仓库 B：oisp-spec（Apache-2.0 / CC-BY）← P6-W5 已规划，本节确认其法律意义
  SoulPackage 目录与 schema 规范、Event 契约、EmbodimentAdapter 接口、
  SCI v0 测量协议、migration log 格式 + 参考代码
  → 纯规范与数据格式，permissive 发布，才能被任何人（含大厂）采纳成标准
```

**铁律**：`oisp-spec` 仓库里的代码**不得 import 任何 AGPL/GPL 包**（否则被传染，失去做标准的资格）。它只依赖宽松许可的东西（pydantic 等）。CI 对 `oisp-spec` 跑 §7 的许可证闸，发现 copyleft 依赖即失败。

> 你个人的 `soul_package/justin/`（露怀秋的身份数据）是**你的私人数据**，永不公开，不涉及项目许可证。

---

## 4. 单项处理决定

### 4.1 MaiBot —— clean-room 重写，不拷代码
P1-W4 原写"拉 hippocampus 模块当库用"。**改为：不 import MaiBot，照其公开**概念**自行重写**情感状态机（孤独/倾诉欲/烦躁/兴奋 + 时间衰减 + 事件→情绪增量）。这本就只是一个百来行的数值衰减模型，clean-room 重写后：① 不继承 GPL；② 不受其 EULA（不鼓励商用/遥测/披露）约束；③ ASTR 对该模块有完全自由。**README/NOTICE 里以"灵感来源"致谢 MaiBot 即可，不作为代码依赖。** → P1-W4 任务卡据此修订。

### 4.2 AstrBot 桥接插件 —— AGPL，发插件市场
插件 import AstrBot SDK，是 AstrBot(AGPL) 的衍生 → 插件 AGPL，分发/联网须提供源码。**主动发到 AstrBot 官方插件市场**：履行义务的同时，坐实"反哺生态、OpenClaw 只是我们一个适配器"的降维叙事。

### 4.3 SillyTavern —— 只经 REST，别改它的码
保持手臂距离（HTTP 调用，独立进程/容器）。**若**确实要改 ST 源码（如剥前端），那部分修改受 AGPL，须公开——尽量改为"不改 ST、只调它暴露的 API"，把定制做在 ASTR 侧。

### 4.4 模型权重 —— 不入仓
任何 `.gguf/.safetensors`（Qwen、RP 微调、视觉、TTS 模型）**都不进 Git 仓库**，由 `astr doctor` / 安装向导引导用户自取（与 §0.4 soul-purity 同构：仓库里不放权重）。Qwen 各尺寸、RP 模型许可在 `THIRD_PARTY_NOTICES.md` 单列并标"用户自行确认"。

### 4.5 Live2D —— 阈值内免费、不可重分发 SDK
个人/营收阈值内免费；超阈值或商用需单独商业授权。仓库**不附 Cubism Core SDK**，由用户按官方流程获取；秋秋专属模型素材的版权另行约定（委托画师时写清授权范围）。

---

## 5. 营销话术红线

- 不要公开说"我们**收编**了 OpenClaw / 兼容了它**整个生态**"。先核对 OpenClaw 的许可证与**商标**；对外用 **"compatible with OpenClaw Skills"**（功能描述）而非"收编/降维"（暗示从属与吞并，易招商标/名誉风险）。
- 不要暗示 ASTR 与 Anthropic/OpenAI/Google/xAI 有合作或背书；它们只是经 API 调用的第三方（MaiBot EULA 4.1 同理：第三方输出不代表你）。
- 对外材料统一口径：ASTR 是 **AGPL 的家庭自持系统**，"骑社区开源基底"，不二次分发任何受限权重。

---

## 5.5 开源生态公民原则（兼容 / 插件市场的硬约束）

> 缘起（2026-06 Jacksky 顾虑）：要兼容 AstrBot / SillyTavern / MaiBot 三家插件、还自建插件市场，会不会像在"抢三家的部署"、伤到开源社区？
> 结论：ASTR 与三根支柱及其插件生态是**复用与互操作**关系，**不是替代/捕获**关系。任何"兼容它们插件"或"自建插件市场"的设计，必须过下面四条；过不了，即与 §0.5 主权立场自相矛盾，退回重做。

**四条硬约束**：
1. **署名 + 回上游**：复用必保留归属（`THIRD_PARTY_NOTICES.md` + README "Built on / Inspired by"）；通用 fix 必 PR 回上游（§6.5）。不"悄悄吸收成自己原创"。
2. **复用而非"重写以取代"**：把三家当**具名组件/格式**用——AstrBot 当网关、ST 当卡/世界书格式、MaiBot 仅 §4.1 clean-room 借概念并致谢——不 fork 一个同类来替死它们。
3. **市场开放 / 联邦，不要围墙**：自建插件市场须 OISP 式开放、**能托管或指向三家生态的插件**，不把它们的插件作者圈进只进不出的花园。
4. **定位指回上游**：对外口径"powered by AstrBot / 兼容 ST 卡"，把用户引向上游，不假装原创全家桶。

**为什么这是硬约束、不是道德附加**：① AGPL 已让"拿了闭源圈占"法律上不可能（§2），ASTR"抢来"的用户/代码仍属同一片公地；② ASTR 占的是**灵魂 / 编排层**，用户用它时底下仍在跑 AstrBot/ST——是做大生态、不是零和（Neuro 火了 OBS/Live2D 社区更旺，没受伤）；③ 与 §0.5 反捕获宣言同构，**吞噬开源同侪 = 自打脸**。

**兼容三家插件的可行性本就不均**（别当成对称的一件事）：AstrBot 插件本就跑在你用的那个 AstrBot 实例里（天然兼容）；ST 真正可复用的是**卡/世界书格式生态**（非其前端 UI 扩展）；MaiBot 插件受 GPL + EULA 牵制（最敏感，照 §4.1 只借概念不碰码）。

**落点**：任何"兼容 / 插件市场"设计卡（P2 OpenClawSkillAdapter 调研、P6 插件市场）必须显式过本节四条 + §5 营销红线。

---

## 6. GitHub 落地清单

1. 主仓 `LICENSE` = AGPL-3.0 全文（从 gnu.org 取官方文本）。
2. `THIRD_PARTY_NOTICES.md`（模板见 `reference_impl/THIRD_PARTY_NOTICES.md`）：逐依赖列 名称/许可/链接/你的修改。每加一个依赖就补一行。
3. 分目录许可边界：主仓 AGPL；`oisp-spec` 独立仓 Apache-2.0/CC-BY，README 写清"本仓不含 copyleft 依赖"。
4. **许可证 CI 闸**（`reference_impl/scripts/check_licenses.py`）：扫已装依赖许可，命中 GPL/AGPL/未知则告警；`oisp-spec` 仓设为"零 copyleft 依赖"硬失败。机器执法，跟 soul-purity 钩子一个套路。
5. fork 干净：AstrBot/MaiBot*/ST 各自 fork **保留上游 git 历史**，你的改动可 diff；通用修复 PR 回上游（社区信誉=最好的营销）。（*MaiBot 按 §4.1 不 fork 代码，只参考。）
6. 上游致谢：README 顶部"Built on / Inspired by"区块，列全部支柱 + 链接。

---

## 7. 验收 / CI 闸

```bash
# 依赖许可扫描（发现 GPL/AGPL/未知即非零退出；oisp-spec 仓用 --strict 禁一切 copyleft）
uv run python scripts/check_licenses.py
uv run python scripts/check_licenses.py --strict          # 用于 oisp-spec 仓

# THIRD_PARTY_NOTICES 覆盖检查：每个已装顶层依赖都要在 NOTICES 里有记录
uv run python scripts/check_licenses.py --verify-notices THIRD_PARTY_NOTICES.md
```

落点：P0-T02 把 `check_licenses.py` 接进 CI（与 ruff/pytest 并列）；P6-W5 完成 `THIRD_PARTY_NOTICES.md` 全量 + oisp-spec 仓的 `--strict` 绿灯。

---

## 8. 律师免责与"必须找律师"的触发点

编者非律师，以上为工程基线。出现下列任一情况，动手前先咨询懂开源的律师：
- 任何**商业化**意图（卖服务/卖支持/双授权/闭源增值）——AGPL 边界与 §3 "手臂距离算不算衍生作品"是灰区，判断错代价大。
- 正式公开发版前的一次性合规复核（LICENSE/NOTICES/分仓边界）。
- 涉及**无审查模型**在中国大陆的分发（总规 §5.2 已标：核心仓放海外、国内只放骨架、权重用户自取）。
- Live2D 商用或营收超阈值。

---

## 9. Phase 落点

- **P0-T02**：CI 接入 `check_licenses.py`（与 soul-purity 钩子并列）；主仓放 AGPL-3.0 `LICENSE` + `THIRD_PARTY_NOTICES.md` 起始版。
- **P1-W4**：按 §4.1 改为 clean-room 重写情感状态机（任务卡已注）。
- **P2**：OmniParser/OpenClaw 许可在调研卡里核实并补进清单。
- **P6-W1/W5**：模块化时确认 §3 双仓边界；`oisp-spec` 仓 Apache-2.0/CC-BY + `--strict` 许可闸；`THIRD_PARTY_NOTICES.md` 全量；营销材料过 §5 红线。
- **§5.5 开源生态公民原则**：约束所有"兼容/插件市场"设计——P2 OpenClawSkillAdapter 调研卡、P6 插件市场设计，开工时必须显式过 §5.5 四条 + §5 红线。
