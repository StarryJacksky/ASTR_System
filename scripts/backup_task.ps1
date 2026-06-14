# 计划任务包装：每日 23:00 由任务计划程序调用，备份 soul_package。
Set-Location "D:\ASTR_System\astr"
& "C:\Users\1\.local\bin\uv.exe" run python -m astr.ops.backup
