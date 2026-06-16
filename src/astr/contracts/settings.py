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

    # —— 语音输入（P1-W7）——
    voice_asr_model_dir: Path = Path("D:/ASTR/embodiments/asr_models/sense-voice")  # SenseVoice ONNX 目录
    voice_vad_model: Path = Path("D:/ASTR/embodiments/asr_models/silero_vad.onnx")
    voice_wake_words: str = "秋秋,露怀秋"  # 逗号分隔；转写命中即唤醒
    voice_sample_rate: int = 16000
    voice_input_device: int | None = None  # None = 系统默认麦克风
    core_ingest_url: str = "http://127.0.0.1:8300/v1/ingest"

    # —— 语音输出（P1-W8）——
    tts_enabled: bool = True
    tts_backend: str = "siliconflow"  # siliconflow(域内可达·CosyVoice) / edge(bing,国内常被墙) / sovits(本地克隆)
    tts_model: str = "FunAudioLLM/CosyVoice2-0.5B"  # SiliconFlow TTS 模型（带情感/方言）
    tts_voice: str = "anna"  # 预设音色名（客户可选）；siliconflow 会拼成 模型:音色
    tts_output_device: int | None = None  # None = 系统默认音箱

    # —— 鉴权白名单（P1-W2-b）：owner 恒 L2；逗号分隔的平台 id 映射等级 ——
    astr_owner_id: str = "jacksky"
    astr_l2_user_ids: str = ""  # 额外 L2，如 "telegram:123,qq:456"
    astr_l1_user_ids: str = ""  # L1（半信任）

    # —— 声纹鉴权（P1-W9）：语音入口只有声纹匹配 owner 才升 L2 ——
    voiceprint_model: Path = Path(
        "D:/ASTR/embodiments/asr_models/voiceprint/3dspeaker_campplus_sv_zh.onnx"
    )  # sherpa-onnx 说话人嵌入模型（CAM++ zh，CPU），缺失则降级
    voiceprint_template_dir: Path = Path("D:/ASTR/ops/voiceprint")  # 注册模板 .npy（访问控制资产，非灵魂）
    voiceprint_threshold: float = 0.62  # 余弦相似度阈值，>= 判为本人
    voice_require_voiceprint: bool = False  # True=强制（未注册则拒绝语音）；默认：已注册自动强制、未注册告警放行

    # —— 看门狗 / 浸泡监控（P1-W9）——
    redis_url: str = "redis://127.0.0.1:6379"
    watchdog_interval_s: int = 30  # 每轮巡检间隔
    watchdog_napcat_container: str = "napcat"  # NapCat 容器名（掉线检测扫其日志）
    watchdog_pending_alert: int = 200  # Redis 消费组 pending 堆积告警阈值
    watchdog_toast: bool = True  # 桌面弹窗告警（best-effort，走 msg.exe）

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
    def health_dir(self) -> Path:
        return self.logs_dir / "health"  # 浸泡 CSV 快照（P1-W9）

    @property
    def core_status_url(self) -> str:
        return self.core_ingest_url.replace("/v1/ingest", "/v1/status")

    @property
    def llama_models_url(self) -> str:
        return self.local_llm_base.rstrip("/") + "/models"

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
