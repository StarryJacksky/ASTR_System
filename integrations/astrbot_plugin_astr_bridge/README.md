# ASTR Bridge（AstrBot 插件 · 受控源）

这是 ASTR Core ⇄ QQ 平台桥插件的**版本控制真身**。AstrBot 的 `data/` 目录被其 `.gitignore` 忽略，
插件本身不进 AstrBot fork 的版本库，所以源码留在 ASTR 主仓这里，部署时复制过去。

## 部署

把本目录复制到 AstrBot 的插件目录，然后重启 AstrBot：

```powershell
Copy-Item -Recurse -Force `
  D:\ASTR_System\astr\integrations\astrbot_plugin_astr_bridge `
  D:\ASTR_System\AstrBot\data\plugins\
```

## 它做什么

- 普通消息 → `POST /v1/respond`，按返回的 `express` 通道发回（text / QQ `face` / `reaction` 贴表情），并 `stop_event()` 阻断 AstrBot 自带 LLM。
- OneBot request/notice（入群邀请 / 被踢 / 禁言 / 好友变动 / 消息被贴表情）→ `POST /v1/event`，按她的决策回应平台（如 `set_group_add_request`）。
- 首次连接拉好友/群列表 → `POST /v1/event`(social_sync)，喂她的自我社交认知。

ASTR Core 地址用环境变量 `ASTR_CORE_URL` 覆盖（默认 `http://127.0.0.1:8300`）。
