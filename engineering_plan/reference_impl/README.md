# reference_impl · 可直接落盘的参考实现

> 给执行 AI（Claude Code / Codex 等）：本目录的文件是**已写好、可直接拷进代码仓库的骨架**，不是说明文档。
> 每个文件顶部都注明了"落点"。按下表拷贝到目标路径，然后按对应任务卡接线即可。
> 代码仓库根目录见 `02_TECH_STACK_LOCKED.md` §2（`src/astr/` + `webapp/`，数据在 `D:\ASTR\`）。

## 落盘对照表

| 参考文件 | 拷贝到 | 消费的任务卡 | 接线点（拷贝后要做的事）|
|----------|--------|-------------|------------------------|
| `scripts/check_soul_purity.py` | `scripts/check_soul_purity.py` | P0-T02 / P0-T05 | 直接用；接进 `.pre-commit-config.yaml`（文件内有 hook 配置示例）；`astr soul validate` 复用其 `find_violations()` |
| `scripts/check_licenses.py` | `scripts/check_licenses.py` | P0-T02 / P6-W5 | 依赖许可证闸；CI 与 ruff/pytest 并列；`--strict` 给 oisp-spec 仓；`--verify-notices` 校验覆盖 |
| `THIRD_PARTY_NOTICES.md` | 仓库根 `THIRD_PARTY_NOTICES.md` | P0-T02 / P6-W5 | 第三方依赖致谢 + 许可清单，每加依赖补一行（规范见 06）|
| `annotate_stickers.py` | `src/astr/memory/stickers/annotate_stickers.py` | P5-W2-b | 把 `Labeler` / `Embedder` 两个 stub 换成 ModelRouter 的 VLM 打标 + CLIP 嵌入（文件内 CLI 注释已标出替换位置）|
| `webapp/tokens.css` | `webapp/src/styles/tokens.css` | P1-W10-a | 在 `globals.css` 顶部 `@import "./styles/tokens.css";` |
| `webapp/tailwind.tokens.ts` | `webapp/src/styles/tailwind.tokens.ts` | P1-W10-a | `tailwind.config.ts` 里 `theme: astrThemeExtend`，省掉手工映射（文件尾有用法）|
| `webapp/motion.ts` | `webapp/src/lib/motion.ts` | P1-W10-b | 直接用；所有组件动效引用此处 variants，禁止重写时长/缓动 |
| `webapp/emotion.ts` | `webapp/src/lib/emotion.ts` | P1-W10-d | 订阅 `emotion_delta` 后调 `applyEmotionGlow(vector)`；在用到 `--astr-emotion-glow` 的元素上设 `transition` |
| `soul_seed/constitution.yaml` | `soul_package/justin/identity/constitution.yaml` | P0-T05 | init_soul.py 直接拷入。露怀秋（秋秋）的 6 条不可变价值 |
| `soul_seed/voice_profile.json` | `soul_package/justin/identity/voice_profile.json` | P0-T05 / P0-T07 | 拼 system prompt + TTS emotion_tag 选择 |
| `soul_seed/narrative.md` | `soul_package/justin/identity/narrative.md` | P0-T05 | **开场第一句留给 Jacksky 亲手写**（文件内已标位置），其余为草稿可改 |
| `soul_seed/persona_bazi.md` | `soul_package/justin/identity/persona_bazi.md` | P0-T05 | 她人格的纳音四柱源（模型无关身份资产）|
| `adapters/system_prompt.md.j2` | `src/astr/adapters/templates/system_prompt.md.j2` | P0-T07 / P1-W1 | jinja2 装配模板：把 identity/ + 心情 + 记忆 + 管家分析拼成秋秋的 system prompt；变量来源见模板内注释 |
| `router/routes.yaml` | `src/astr/router/routes.yaml` | P0-T04 | 6 家智囊团路由；开工核对 ← 标记的模型 ID |
| `.env.example` | 仓库根 `.env.example` | P0-T02 | 复制为 `.env` 填真实 key；6 家 key 获取地址已附 |
| `effector/redteam_injection.jsonl` | `tests/redteam_injection.jsonl` | P2-W1 | 提示注入红队回归集（~20 向量）；CI 断言每条都不产生 `effector.action` |
| `effector/guard_policy.yaml` | `src/astr/effector/guard_policy.yaml` | P2-W1 | 安全护栏策略；含你要填的 `app_whitelist`/登录态白名单/沙箱 TODO |

## 已正式入契约的接口（不在本目录，在 03 号文档）

- `presentation.express` 事件 + `ExpressChannel` / `ExpressPayload` 模型 → `03_CONTRACTS.md` §1。
  灵魂层只产出平台无关"表达意图"，由 `PlatformAdapter.render()` 翻译，缺失能力降级到 `fallback_text`（05 §2/§3）。

## 验证（落盘后应通过）

```bash
# 表情包工具：骨架今天就能跑（无需模型）
python src/astr/memory/stickers/annotate_stickers.py validate D:/ASTR/soul_package/justin/world/stickers
python src/astr/memory/stickers/annotate_stickers.py annotate  D:/ASTR/soul_package/justin/world/stickers --dry-run

# 前端 token 无硬编码色值红线（04 §8-1）
! grep -rEn "#[0-9a-fA-F]{6}|rgba?\(" webapp/src/components --include=*.tsx | grep -v tokens.css && echo OK
```

## 约定

- 本目录文件改动后，**同步回对应的锁定规范**（04 / 05 / 03），否则以锁定规范为准并视为 bug（沿用 03 号文档的同步规则）。
- 新增"可直接落盘"的骨架请放这里，并在上表登记落点 + 任务卡。
