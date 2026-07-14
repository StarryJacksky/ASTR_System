# Third-Party Notices · ASTR

> 落点：仓库根 `THIRD_PARTY_NOTICES.md`。规范：`engineering_plan/06_LICENSING_AND_COMPLIANCE.md`。
> 规则：每引入一个第三方依赖就补一行；`scripts/check_licenses.py --verify-notices` 会检查覆盖。
> ✅=已核实到源文件/官方仓库；⚠️=开工时按当时版本核对。

ASTR 是 AGPL-3.0 项目，建立在以下开源/第三方组件之上，谨此致谢并声明各自许可证。

## 核心生态（copyleft —— 决定了 ASTR 整体为 AGPL-3.0）

| 组件 | 许可证 | 主页 | ASTR 的使用方式 / 修改 | 核实 |
|------|--------|------|------------------------|:---:|
| AstrBot | AGPL-3.0 | https://github.com/AstrBotDevs/AstrBot | 中枢网关；ASTR 写桥接插件（插件随之 AGPL，已发插件市场）。AstrBot 在独立进程，经 HTTP 调 astr core | ✅ |
| SillyTavern | AGPL-3.0 | https://github.com/SillyTavern/SillyTavern | 海马体存储；**仅经其 REST API 调用，未修改其源码**（手臂距离） | ✅ |
| MaiBot | GPL-3.0 + EULA | https://github.com/MaiM-with-u/MaiBot | **未使用其代码**；情感状态机为 clean-room 重写，仅概念致谢（见 06 §4.1） | ✅ |

## 模型（权重不入仓，用户自取；许可用户自行确认）

| 组件 | 许可证 | 主页 | 说明 | 核实 |
|------|--------|------|------|:---:|
| Qwen3-8B（及更大尺寸）| Apache-2.0（按尺寸核对）| https://github.com/QwenLM/Qwen3 | 本地灵魂躯壳；部分尺寸或走 Tongyi 协议 | ⚠️ |
| 社区无审查 RP 微调 | 各异（常 cc-by-nc / 不明）| —（用户自选）| 灵魂增强；**不分发权重** | ⚠️ |
| GPT-SoVITS | MIT | https://github.com/RVC-Boss/GPT-SoVITS | TTS 克隆 | ✅ |
| Florence-2 / OmniParser-v2 | 代码 MIT / 权重另议 | https://github.com/microsoft/OmniParser | 视觉 grounding（P2）；权重许可单独核对 | ⚠️ |
| openWakeWord / silero-vad / SenseVoice / bge-m3 | Apache-2.0 / MIT（核对）| 各官方 | 感官与嵌入 | ⚠️ |

## 皮囊

| 组件 | 许可证 | 主页 | 说明 | 核实 |
|------|--------|------|------|:---:|
| Live2D Cubism SDK | 专有（营收阈值下免费）| https://www.live2d.com/ | **SDK 不入仓**，用户按官方流程获取；不可改/重分发 | ⚠️ |

## 基建（宽松许可，`check_licenses.py` 兜底）

| 组件 | 许可证 | 说明 |
|------|--------|------|
| LiteLLM | MIT | 模型路由 |
| Redis | RSALv2/SSPL（核对版本）| ⚠️ 事件总线；7.x 许可需确认，必要时换 Valkey(BSD) |
| ChromaDB | Apache-2.0 | 向量缓存 |
| FastAPI / Uvicorn / Pydantic / structlog / APScheduler | MIT/BSD/Apache | 后端基建 |
| Next.js / React / TailwindCSS / Framer Motion / shadcn-ui / Radix | MIT | 前端 |
| llama.cpp / vLLM | MIT / Apache-2.0 | 推理引擎 |

## 待核实（开工/对应 Phase 补全）

- OpenClaw（P2 调研）：许可证 + 商标 ⚠️ 未核实——对外措辞用 "compatible with"，见 06 §5。
- Redis 7.x 许可证版本；如不合规改 Valkey。
- OmniParser 权重、各模型的商用条款。

---
完整许可证文本：见各依赖仓库的 LICENSE；本项目主仓 LICENSE = AGPL-3.0（gnu.org 官方文本）。
