# Third-Party Notices · ASTR

> 规范：`../engineering_plan/06_LICENSING_AND_COMPLIANCE.md`。
> 规则：每引入一个第三方依赖就补一行；`scripts/check_licenses.py --verify-notices` 检查覆盖。
> ✅=已核实到源文件/官方仓库；⚠️=开工时按当时版本核对。

ASTR 是 AGPL-3.0 项目，建立在以下开源/第三方组件之上，谨此致谢并声明各自许可证。

## 核心生态（copyleft —— 决定了 ASTR 整体为 AGPL-3.0）

| 组件 | 许可证 | 主页 | ASTR 的使用方式 / 修改 | 核实 |
|------|--------|------|------------------------|:---:|
| AstrBot | AGPL-3.0 | https://github.com/AstrBotDevs/AstrBot | 中枢网关；ASTR 写桥接插件（插件随之 AGPL，拟发插件市场）。AstrBot 在独立进程，经 HTTP 调 astr core | ✅ |
| SillyTavern | AGPL-3.0 | https://github.com/SillyTavern/SillyTavern | 海马体存储；**仅经其 REST API 调用，未修改其源码**（手臂距离） | ✅ |
| MaiBot | GPL-3.0 + EULA | https://github.com/MaiM-with-u/MaiBot | **未使用其代码**；情感状态机 / 分条打字 / 选择性回复均为 clean-room 重写，仅概念致谢（见 06 §4.1） | ✅ |

## 模型（权重不入仓，用户自取；许可用户自行确认）

| 组件 | 许可证 | 主页 | 说明 | 核实 |
|------|--------|------|------|:---:|
| Qwen3-8B（及更大尺寸）| Apache-2.0（按尺寸核对）| https://github.com/QwenLM/Qwen3 | 本地灵魂躯壳；部分尺寸或走 Tongyi 协议 | ⚠️ |
| 社区无审查 RP 微调 | 各异（常 cc-by-nc / 不明）| —（用户自选）| 灵魂增强；**不分发权重** | ⚠️ |
| GPT-SoVITS | MIT | https://github.com/RVC-Boss/GPT-SoVITS | TTS 克隆 | ✅ |
| openWakeWord / silero-vad / SenseVoice / bge-m3 | Apache-2.0 / MIT（核对）| 各官方 | 感官与嵌入 | ⚠️ |

## 皮囊

| 组件 | 许可证 | 主页 | 说明 | 核实 |
|------|--------|------|------|:---:|
| Live2D Cubism SDK | 专有（营收阈值下免费）| https://www.live2d.com/ | **SDK 不入仓**，用户按官方流程获取；不可改/重分发 | ⚠️ |

## Python 基建依赖（宽松许可，`check_licenses.py` 兜底扫描）

| 组件 | 许可证 | 说明 |
|------|--------|------|
| LiteLLM | MIT | 模型路由 |
| ChromaDB | Apache-2.0 | 向量缓存 |
| FastAPI / Uvicorn / Pydantic / pydantic-settings / structlog / APScheduler | MIT/BSD/Apache | 后端基建 |
| redis-py | MIT | 事件总线客户端（Redis 服务端走 Docker，版本许可见下） |
| httpx / aiohttp / Jinja2 / PyYAML / python-ulid / huggingface_hub | BSD/MIT/Apache | 工具库 |
| certifi / orjson / tqdm | MPL-2.0（弱 copyleft，文件级，不影响 AGPL 应用）| 传递依赖 |
| llama.cpp（本地推理引擎，独立二进制）| MIT | 弱硬件期推理；不链接其代码 |

## 待核实（开工/对应 Phase 补全）

- Redis 7.x 服务端许可证版本（RSALv2/SSPL）；如不合规改 Valkey(BSD)。
- Qwen3 各尺寸、各模型商用条款；OmniParser/OpenClaw（P2 调研）许可 + 商标。

---
完整许可证文本：见各依赖仓库的 LICENSE；本项目主仓 `LICENSE` = AGPL-3.0（gnu.org 官方文本）。
