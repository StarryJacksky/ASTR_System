# 视觉 CU 架构调研（2026-07-05）——如何达到 Codex/Operator 同级体验

> 背景：P2 visual 里程碑真机迭代 7 轮，暴露两个结构性差距：①单步 ~40s（Codex 体感实时）；
> ②注入的是主人的真鼠标（Jacksky 要求"像 Codex 一样用额外的鼠标"）。三路并行调研（一手来源）后的裁定。

## 一、事实校正：Codex 的"额外鼠标"是什么

- **Operator / ChatGPT agent**：动作全部发生在 **OpenAI 云端虚拟计算机**上（虚拟浏览器/终端/文件区，ephemeral 沙箱）——"额外鼠标"= 那台云电脑自己的席位，不碰用户机器。（openai.com/index/introducing-operator, /introducing-chatgpt-agent）
- **Codex App 本地 computer use（2026）**：**用的就是用户的真鼠标真键盘**——macOS 授屏幕录制+辅助功能，Windows 接管前台指针，按 app 逐个审批（同我们的 app_whitelist 思路）。（developers.openai.com/codex/app/computer-use）
- **"丝滑"的真相**：无动作流式/预测执行的公开证据；单步 2–5s（官方："优化成功率，不优化延迟"）。体感快靠：①云端异步后台跑；②能走文本浏览器/终端/API 就不走视觉（=我们的"接口优先视觉兜底"）；③端到端 VLM 看图直出坐标，没有元素解析中间层。
- **Anthropic computer use**：只给模型层（截图→坐标动作），执行环境用户自建（参考实现 Docker+Xvfb+xdotool）。像素 grounding 端到端，新版带 zoom 动作。

## 二、感知-规划：两段式已被端到端淘汰

| 方案 | GUI 定位（ScreenSpot-Pro） | 单步延迟 | 备注 |
|---|---|---|---|
| OmniParser-v2 + GPT-4o（我们现架构同型） | 39.6 | 本地实测感知 35s（未优化；官方 A100 0.6s/帧） | 两段式：解析+规划两次调用 |
| **UI-TARS-1.5-7B**（字节，Apache 2.0） | **49.6** | vLLM 数据中心卡 ~0.45s；3070Ti GGUF Q4 估 2–6s | **8GB 可跑**（Q4_K_M 4.7GB），llama.cpp 生态 |
| Holo1.5-3B | 51.5 | 更快更省 | **不可商用**（Qwen Research license） |
| Gemini computer-use API | —（端到端任务型） | 官方称延迟最低 | 0-999 归一化坐标；价格约 Claude 1/3 |
| Claude Sonnet computer-use | OSWorld 61.4%（任务成功率第一） | 2–5s/步 | 像素坐标原生 |

我们实测拆解（3070 Ti）：YOLO 0.5s + OCR 6.2s（**CPU 跑的**）+ Florence caption ~100ms/个×百余图标 ≈ 35s。
即使不换架构也能压到 3–7s（OCR 上 GPU/降采样、caption 按需）；但端到端**又快又准还省一层**，方向明确。

## 三、第二席位：单机 Windows 的三档

| 档 | 方案 | 判定 |
|---|---|---|
| 干净解 | **Hyper-V VM + 执行 daemon 装进 VM**（VM 天生独立席位/桌面/光标；Core 从宿主经 HTTP 编排。比外部 FreeRDP framebuffer hook 简单一个量级——VM 内直接跑现成 WindowsBackend） | ✅ 推荐，P3/P6 落 |
| 轻量兜底 | 触摸注入 `InjectSyntheticPointerInput`（PT_TOUCH 不动宿主光标）+ UIA | ⚠️ 键盘焦点仍撞车，兼容性看 app |
| 灰色 | RDP Wrapper 本机第二会话 | ❌ 违反 EULA，不进产品 |
| 已落（过渡） | **礼让机制**（input_idle 检测主人活动→暂停让位）+ 焦点回切 | ✅ P2 已实现 |

注：Windows Sandbox 无输入/截屏编程 API；Hyper-V WMI 只有键盘（Msvm_Keyboard）无鼠标；同桌面 PostMessage 对现代 app 不可靠。业界（UI-TARS Desktop 等）本地模式同样占宿主席位，其 Remote Operator 模式即"打到另一台/另一会话"。

## 四、裁定（按物质基础具体分析：3070Ti 8GB + Win10 Pro）

1. **P2 收尾（立即）**：CuEngine 规划段换**云端端到端 grounding**（Gemini computer-use 或 Claude computer-use，key 已有）——截图直入、坐标直出，单步 40s→2-5s。OmniParser 降级为离线兜底/审计标注。guard/急停/审计/礼让不动。
2. **P2.5**：**UI-TARS-1.5-7B GGUF Q4** 进 llama.cpp（与 Qwen3-8B 同栈，vram_broker 换装）——本地端到端，断网可用。
3. **P3/P6**：**Hyper-V VM 第二席位**——effector daemon 进 VM，她拥有整台"自己的电脑"，与 Codex 云 VM 同构；宿主席位从此只属于主人。授权：VM 里 Windows 需另一份 license（或 Linux 客机跑 Wine 场景受限——按需求定）。

全部一手来源 URL 见调研原文（本文档为裁定摘要；三份完整调研在 session 记录中，关键来源已内联）。
