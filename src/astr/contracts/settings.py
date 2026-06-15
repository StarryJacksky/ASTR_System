"""全项目唯一配置入口（02 §3-5：禁止裸 os.environ）。

为什么集中在这里：所有 API key 只在 ModelRouter 进程经本类读取，永不进代码/日志；
所有路径统一从 ASTR_DATA_DIR 派生，保证 Windows 上用正斜杠 + pathlib 一致寻址。
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """读 .env 的强类型配置。字段名与 .env.example 对齐（大小写不敏感）。"""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # —— 智囊团 6 家 key（仅 ModelRouter 读取，永不入日志）——
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    gemini_api_key: str = ""
    xai_api_key: str = ""
    deepseek_api_key: str = ""
    # 云 Qwen 走硅基流动（SiliconFlow，OpenAI 兼容）；保留 dashscope 字段以备切换
    siliconflow_api_key: str = ""
    dashscope_api_key: str = ""

    # —— 本地推理与数据目录 ——
    astr_data_dir: Path = Path("D:/ASTR")
    local_llm_base: str = "http://127.0.0.1:8080/v1"
    local_llm_model: str = "qwen3-8b"

    # —— 预算闸与 MoA 策略 ——
    astr_daily_budget_usd: float = 5.0
    moa_short_max_chars: int = 10  # < 此当量：短消息→2 席
    moa_long_min_chars: int = 30  # >= 此当量：长消息→6 席全开；中间→4 席

    # —— 平台 ——
    telegram_bot_token: str = ""

    # —— 鉴权白名单（P1-W2-b）：owner 恒 L2；逗号分隔的平台 id 映射等级 ——
    astr_owner_id: str = "jacksky"
    astr_l2_user_ids: str = ""  # 额外 L2，如 "telegram:123,qq:456"
    astr_l1_user_ids: str = ""  # L1（半信任）

    def _csv(self, raw: str) -> set[str]:
        return {x.strip() for x in raw.split(",") if x.strip()}

    def resolve_level(self, user_id: str) -> int:
        """平台 id → 鉴权等级。声纹双因素在 P1-W9 升级。"""
        if user_id == self.astr_owner_id or user_id in self._csv(self.astr_l2_user_ids):
            return 2
        if user_id in self._csv(self.astr_l1_user_ids):
            return 1
        return 0

    # —— 派生路径（不从 env 读，由 astr_data_dir 计算）——
    @property
    def soul_package_dir(self) -> Path:
        return self.astr_data_dir / "soul_package"

    @property
    def embodiments_dir(self) -> Path:
        return self.astr_data_dir / "embodiments"

    @property
    def runtime_cache_dir(self) -> Path:
        return self.embodiments_dir / "runtime_cache"

    @property
    def ops_dir(self) -> Path:
        return self.astr_data_dir / "ops"

    @property
    def golden_set_dir(self) -> Path:
        return self.ops_dir / "golden_set"

    @property
    def eval_reports_dir(self) -> Path:
        return self.ops_dir / "eval_reports"

    @property
    def logs_dir(self) -> Path:
        return self.ops_dir / "logs"

    @property
    def ledger_db(self) -> Path:
        return self.ops_dir / "astr.db"

    # 默认灵魂句柄（路径前缀，稳定不变，见 03 §2）
    soul_name: str = Field(default="justin", exclude=True)

    @property
    def soul_dir(self) -> Path:
        return self.soul_package_dir / self.soul_name


@lru_cache
def get_settings() -> Settings:
    """单例配置。代码各处通过它取配置，禁止直接读 os.environ。"""
    return Settings()
