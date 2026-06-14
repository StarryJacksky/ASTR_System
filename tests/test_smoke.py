"""P0-T02 冒烟测试：确保包结构与唯一配置入口可导入。CI 的第一道绿灯。"""

from __future__ import annotations

import importlib


def test_imports() -> None:
    """全部子包可导入——五层解耦结构在 CI 里有人盯着，不许 import 时就崩。"""
    for mod in (
        "astr",
        "astr.contracts",
        "astr.contracts.settings",
        "astr.bus",
        "astr.router",
        "astr.soul",
        "astr.memory",
        "astr.adapters",
        "astr.sensors",
        "astr.effector",
        "astr.presentation",
        "astr.ops",
    ):
        importlib.import_module(mod)


def test_settings_defaults() -> None:
    """没有 .env 也能起：默认值兜底，数据目录指向 D:/ASTR。"""
    from astr.contracts.settings import Settings

    s = Settings(_env_file=None)
    assert s.local_llm_model == "qwen3-8b"
    assert s.soul_dir.as_posix().endswith("soul_package/justin")
