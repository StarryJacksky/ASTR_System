# trycua/cua 取经调研 · 2026-07-06

> 背景：P2.5 本地里程碑 12 轮未过；Jacksky 报"键盘用不了、删除都删不了、只会复制粘贴"，
> 并指定"像 AstrBot/麦麦那样把 cua 作为组件搞下来组装"。
> 对象：https://github.com/trycua/cua ——三系统 computer-use 开源组件，MIT，19.4k 星、
> 546 releases、活跃。已下载全仓精读（scratchpad clone 换机即失，重取见文末）。

## 一、它是什么（分层，与我们逐层对照）

cua 是**分层的 computer-use 全家桶**，不是单体 agent：

| cua 层 | 干什么 | 我们的对应 | 取舍 |
|---|---|---|---|
| **cua-driver**（Rust） | 背景注入的底层驱动，MCP over stdio | `platform_backend.py`（pyautogui/SendInput） | **换成它** |
| computer-server | 把驱动包成 OpenAI 兼容/WS 服务，跨 win/mac/linux/android | 无 | 可选 |
| computer（SDK） | `computer.interface.click/type/screenshot` 统一 API | CuEngine 的 backend 调用 | 可包 |
| **agent**（20 个 loop） | 各家模型的 CU 循环，litellm 驱动 | `cu_engine._plan_step*` | **借它的架构** |
| som | Set-of-Marks 视觉标注 | `omni_perceiver.py` | 平手 |
| lume/lumier | Apple Silicon VM 管理 | 无（P6 第二席位相关） | mac 迁移时看 |

## 二、命中我们三个死穴（为什么值得动架构）

### 1. 键盘问题的真因 + 解法 ★Jacksky 亲报的 bug
- **cua-driver/rust/crates/platform-windows/src/lib.rs 自述**：Windows 背景自动化用
  `PostMessage(WM_LBUTTONDOWN/UP)` 注入鼠标、`PostMessage(WM_CHAR / WM_KEYDOWN/UP)` 注入键盘。
- **对照我们的 bug**：我们的 `backend.key()` 走 pyautogui→SendInput，投进**全局输入队列**，
  被这台机器某种输入链路吞了（实测 ctrl+shift+n/Alt 键提示全聋）。PostMessage **直投目标窗口
  的消息队列**，不经全局队列——这正是"键盘用不了但复制粘贴能用"的解释（ctrl+v 那次恰好焦点对）。
  换 PostMessage 注入，键盘问题结构性消失。
- **附赠**：PostMessage 注入**不抢焦点**（driver README 原话"drives native apps without
  stealing focus"）——这是我们 HANDOFF 排到 P6 的"真第二席位"，cua 在 driver 层直接给了，
  比 Hyper-V VM 简单一个量级。礼让机制可退化为可选。

### 2. 7B 编排弱 → composed_grounded loop ★enikk 调研 #2 的现成实现
- `agent/cua_agent/loops/composed_grounded.py`：**grounding 模型 + thinking 模型两段式**——
  thinking 模型用"元素描述"（"红色提交按钮"）推理，grounding 模型把描述转成坐标。
  这正是我 enikk 调研里提的"让 qwen3-8b 想、让定位器看"，cua 已实现且带 litellm 多模型编排。
- 20 个 loop 里已有 `uitars`/`uitars2`/`omniparser`/`qwen3vl`/`opencua` 等——我们八轮 UI-TARS
  的活儿它有现成对应，本地档不必从零调 prompt。

### 3. 基建不自研（99#4 的原话落地）
- litellm 驱动（155 处引用）——我们 router 也早该基于它；ollama/localhost/base_url/HF 本地
  endpoint 全支持，qwen3-8b/UI-TARS 直接接。MIT 许可，可 vendor 可 pip。

## 三、组装方案（Jacksky 定调"像 AstrBot/麦麦那样作为组件"）

**裁定：采纳 cua 作为效应器的"执行+定位"底座，我们的护栏/灵魂/技能层盖在上面。**
分工——cua 管"手和眼"（driver 注入 + agent loop 定位），我们管"魂和法"（guard 三档审批/
危险确认/审计链/急停/地盘围栏 + 灵魂上下文 + 系统操作指南）。这与我们既有裁定一致：
自研额度花在灵魂和护栏，不花在 CU 基建。

**落地路径（建议 P2.5 二期，按依赖排）**：
1. **验证 driver 注入**：单起 cua-driver，对资源管理器发 PostMessage 键盘（ctrl+shift+n），
   看是否破我们 SendInput 的聋——这是整个方案的地基，先证实再谈组装。
2. **backend 换血**：`platform_backend.WindowsBackend` 的 click/key/type 底层从 pyautogui
   换 cua-driver（或直接用 computer SDK）。**护栏/围栏/审计接口不动**——它们在 backend 之上，
   换手不换法。急停要确认能穿透 driver（PostMessage 那条也得能被 estop 打断）。
3. **规划换 composed_grounded**：CuEngine 的 grounded 规划借 cua 的两段式——qwen3-8b 当
   thinking（本地、语言强）、UI-TARS/OmniParser 当 grounding。截图不出网的隐私档保住。
4. **技能库继续喂**：os_skills 指南照旧注入（知识外置不因换底座失效）；补全 Windows 完全指南
   （Jacksky 明确要"完全的"：浏览器/开始菜单/任务栏/设置/记事本/终端/输入法/窗口管理各一篇）。
5. **第二席位提前**：若 driver 背景注入实测稳，P6 的 Hyper-V 第二席位可提前到 P2.5——
   她在不抢主人焦点的前提下操作，礼让从"必须"降为"可选保险"。

**风险/未决**：
- driver 是 Rust，要么用它编好的 wheel（`libs/cua-driver/python`）要么本地编译（需 Rust 工具链）。
- PostMessage 注入对某些应用（游戏/DirectInput/权限隔离窗口）无效，兜底仍需 SendInput 那条——
  保留双通道，按应用选。
- 引入外部大组件要过 license/CI 纯净检查（MIT 兼容，但 agent[omni] 带 ultralytics 是 AGPL，
  与我们 vision extra 同款处理）。
- **别丢护栏**：cua 自己没有审批档/危险确认/审计链——这是我们的命根子，组装时护栏必须在
  cua 调用的**外层**，不能让 agent loop 直接摸驱动绕过 guard。

## 四、重取命令（scratchpad clone 换机即失）
```bash
# 国内网络 git clone 会超时（仓库大 + LFS），走 tarball：
curl.exe -sL -o cua.tar.gz "https://codeload.github.com/trycua/cua/tar.gz/refs/heads/main"
tar -xzf cua.tar.gz   # 会因 LFS 符号链接报几条错，无妨，主体已出
# 关键文件：
#   libs/cua-driver/rust/crates/platform-windows/src/lib.rs   ← PostMessage 注入自述
#   libs/python/agent/cua_agent/loops/composed_grounded.py    ← 两段式规划
#   libs/python/agent/cua_agent/loops/{uitars,omniparser,qwen3vl}.py
#   libs/python/computer-server/computer_server/handlers/windows.py
```

## 五、裁定一句话
enikk 给了思想（知识外置、窗口作用域、渐进感知），cua 给了工程（背景注入解键盘+第二席位、
composed_grounded 解 7B 编排、litellm 解基建）。**两者叠加正好补齐我们八轮里程碑撞的所有墙**。
采纳 cua 作底座，护栏/灵魂/技能层不动——这是 P2.5 该转的弯，不是推倒重来。
