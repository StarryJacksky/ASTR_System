# ASTR 工程规划索引

本目录是原先位于仓库外 `D:\ASTR_System\engineering_plan` 的完整工程规划归档。自 2026-07-14 起，它随代码仓版本化，换机或克隆后不再依赖父目录文件。

## 核心基线

1. [`00_MASTER_PLAN.md`](00_MASTER_PLAN.md)：工程总规。
2. [`01_HARDWARE_AND_MODELS.md`](01_HARDWARE_AND_MODELS.md)：硬件与模型策略。
3. [`02_TECH_STACK_LOCKED.md`](02_TECH_STACK_LOCKED.md)：锁定技术栈。
4. [`03_CONTRACTS.md`](03_CONTRACTS.md)：跨模块合同与事件语义。
5. [`04_DESIGN_SYSTEM.md`](04_DESIGN_SYSTEM.md)：设计系统基线。
6. [`05_PLATFORM_CAPABILITIES.md`](05_PLATFORM_CAPABILITIES.md)：平台能力边界。
7. [`06_LICENSING_AND_COMPLIANCE.md`](06_LICENSING_AND_COMPLIANCE.md)：许可与合规。
8. [`07_ADMIN_CONSOLE.md`](07_ADMIN_CONSOLE.md)：管理台规划。
9. [`08_DISCUSSION_ENGINE.md`](08_DISCUSSION_ENGINE.md)：讨论引擎规划。
10. [`99_IMPROVEMENTS.md`](99_IMPROVEMENTS.md)：后续改进清单。

## 配套材料

- [`phases/`](phases/)：P0–P6 分阶段路线。
- [`research/`](research/)：CUA、计算机使用与相关架构调研。
- [`reference_impl/`](reference_impl/)：规划期参考实现，不等于当前生产实现。`reference_impl/soul_seed/` 的 4 份私人身份种子有意不纳入公开代码仓；真身只保留在受控 Soul 数据仓。
- [`../docs/superpowers/specs/`](../docs/superpowers/specs/)：本轮确认后的前端设计规范。
- [`../docs/superpowers/plans/`](../docs/superpowers/plans/)：本轮逐批实施计划。
- [`../CODEX_HANDOFF.md`](../CODEX_HANDOFF.md)：当前实现事实、前后端打通路线与 Mac 迁移手册。

规划文件描述目标和约束，不自动证明功能已经上线。若旧规划与当前实现冲突，以现行代码、合同测试和 `CODEX_HANDOFF.md` 的“当前事实”为准；需要改变合同或安全边界时，应先更新对应设计/威胁模型，再进入实现。
