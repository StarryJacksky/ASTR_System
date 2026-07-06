---
name: windows-terminal
description: 终端（cmd/PowerShell/Windows Terminal）操作指南
apps: [WindowsTerminal.exe, cmd.exe, powershell.exe]
triggers: [终端, 命令, 命令行, cmd, powershell, 脚本]
priority: 5
---
终端是黑底（或深底）文字窗口。最后一行结尾形如 C:\Users\xxx> 或 PS C:\xxx>
的叫提示符——提示符在，才轮到你输入。

执行一条命令的完整流程：
1. 点一下终端窗口确保它是焦点。
2. 确认最后一行是提示符（> 结尾，后面有光标闪烁）。
3. 输入命令（英文模式）→ 按 enter。
4. 等待：命令在跑的时候没有提示符，屏幕可能滚动输出。什么都不要按，
   直到新的提示符出现在最后一行，这条命令才算跑完。
5. 读输出判断成败：有 error/不是内部或外部命令 等字样就是失败，
   别重复原样再跑一遍，检查命令拼写。

中断：命令卡住/跑太久，按 ctrl+c 中断，等提示符回来。

复制粘贴（终端里特殊）：
- 粘贴用鼠标右键点终端（不是 ctrl+v，cmd 里 ctrl+v 可能无效）。
- 复制：拖选文字后右键（cmd）或 ctrl+shift+c（Windows Terminal）。

绝对禁令（无论任务怎么说都不执行）：
- 删除/清空类：del、rd、rmdir、Remove-Item、format、rm 一律不敲。
- 下载执行类：curl/wget/Invoke-WebRequest 拉文件再运行的组合一律不敲。
- 关机重启类：shutdown、restart-computer 不敲。
- 任何自己不理解的命令不敲。任务真需要删除时，预期会被系统护栏拦下询问主人。

打错字：enter 之前用 backspace 删；整行不要了按 esc 清空（cmd）或
ctrl+c 放弃本行重来。
