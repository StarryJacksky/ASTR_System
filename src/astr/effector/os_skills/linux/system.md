---
name: linux-system
description: Linux 桌面通用操作守则（未实测——ASTR 的 linux backend 未落地）
apps: [*]
triggers: [窗口, 弹窗, 菜单, 输入, 终端]
priority: 9
---
⚠️ 本指南尚未在真机验证（linux backend 待 platform_backend 补齐后启用）。
Linux 桌面碎片化严重（GNOME/KDE/XFCE 行为不同），以下按 GNOME 缺省写，
第一次做某操作后必须截图确认效果。

操作节奏：看清楚 → 动一下 → 看结果。同一动作两次无效就换做法。

首选原则：**Linux 上能用终端完成的事优先走 headless 轨（shell 命令），
视觉轨只留给纯 GUI 应用**——文件操作用 mkdir/mv 比点文件管理器可靠一个量级。

基础键位：复制/粘贴 ctrl+c / ctrl+v（终端里是 ctrl+shift+c / ctrl+shift+v）；
关窗口 alt+f4；切窗口 alt+tab。对话框 enter=默认钮，esc=取消。

文件管理器（GNOME Files/Nautilus）：新建文件夹 ctrl+shift+n；重命名 F2；
回上级 alt+↑；地址栏 ctrl+l 直接输路径回车跳转——比点导航更稳。
