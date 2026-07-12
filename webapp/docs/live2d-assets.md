# ASTR Live2D 资源来源、许可与完整性

ASTR 不把 Cubism Core、示例模型、纹理或音频提交进 Git。干净检出必须安全降级为 `StaticSoulLens`；只有本机资源逐字节通过 `live2d-assets.lock.json` 的长度与 SHA-256 校验后，才允许启用 Live2D。

## 两组独立许可

1. **Haru / Shizuku 示例素材**来自 [`guansss/pixi-live2d-display`](https://github.com/guansss/pixi-live2d-display/tree/31317b37d5e22955a44d5b11f37f421e94a11269/test/assets)，固定到不可变提交 `31317b37d5e22955a44d5b11f37f421e94a11269`。上游说明这些示例素材按 [Live2D Free Material License Agreement](https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html) 再分发；Live2D 的 [Haru 官方页面](https://www.live2d.com/en/learn/sample/haru/) 还明确要求同时接受 [Live2D Cubism Sample Data Terms of Use](https://www.live2d.com/eula/live2d-sample-model-terms_en.html)。这些条款不是项目其余源码的许可证，也不能推定它们允许任意再分发或商用方式。
2. **Cubism Core**来自 Live2D 官方 Web SDK convenience endpoint，并受 [Live2D Proprietary Software License Agreement](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html) 约束。它不是开源依赖，不得因下载脚本存在就假定已获得再分发权。

示例条款把 Haru 与 Shizuku 都列为 Live2D Original Characters，并要求作品标示版权。对应用、页面或其他难以放置长说明的载体，至少保留官方指定的短声明：**“This content uses sample data owned and copyrighted by Live2D Inc.”**。锁清单把这段声明作为后续 UI 集成的必备事实。两段 `shizuku/sounds/*.mp3` 是 Haru 固定 model3 直接引用的、未修改的 Shizuku 示例音频；不得把它们误写成 ASTR 自有音频或脱离上述条款另行分发。

运行下载命令即意味着操作者已自行审阅并接受上述两组条款：

```powershell
node scripts/fetch-live2d.mjs --download --accept-live2d-licenses
```

只做本机预检不代表接受许可，也不会联网：

```powershell
node scripts/fetch-live2d.mjs --check
```

## 不可变性与失败关闭

- 模型、动作、表情、纹理与音频 URL 都包含固定提交；脚本拒绝 `master`、`main` 或 `latest` 一类浮动来源。
- Cubism Core 的官方 convenience endpoint 没有在响应文件中给出可核实的精确 SDK 发布号。因此这里不猜测版本，改以 2026-07-12 获取的确切字节为权威快照：`207155` bytes，SHA-256 `25ae938cb4fe282ce189b357bcc97e603d1e1f7ec78bf04150d401c23cdc792f`。
- 若官方 endpoint 后续更换内容，下载会因长度或 SHA-256 不匹配而中止；维护者必须重新审阅许可证和上游变更后，才能有意识地更新锁文件。
- 所有下载都先在内存中校验，再写入 `public/live2d`。该目录被 Git 忽略。
- Haru 的模型 JSON 引用了可选的 `haru_greeter_t03.cdi3.json`，但它在固定上游提交中 missing / HTTP 404。锁文件把这个 DisplayInfo 引用明确记录为“已知可选缺失”；moc、纹理、动作、表情和音频缺失则一律失败关闭。

## 维护核对表

更新任何资源时必须同时完成：核对固定来源、重新阅读许可、计算真实字节数与 SHA-256、验证模型内全部相对引用、运行 `--check`，并确认无资源时仍只呈现静态灵魂透镜。测试和 CI 不得依赖开发者机器上被忽略的二进制文件。
