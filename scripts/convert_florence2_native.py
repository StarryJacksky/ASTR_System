"""把 OmniParser-v2 icon_caption（旧 remote-code 命名）转成 transformers 5.x 原生 Florence-2 格式。

为什么存在：官方 OmniParser 权重沿用 microsoft/Florence-2 旧目录结构（auto_map 指向
仓库远程代码），在国内网络 + transformers 5.x 下既连不上也不兼容。transformers 5.x
原生支持 Florence-2 但换了权重命名，且官方转换脚本没随包/仓库发布。

转换策略（零猜测）：微软原版 base-ft 与社区转换版 florence-community/Florence-2-base-ft
数值相同、命名不同——按"张量数值指纹相等"反推旧名→新名的精确映射，再套用到
OmniParser 微调权重上。词表扩容部分（51289→51328，image token+padding）直接复用
社区转换版的新增行。最后 strict 加载进原生类做全量校验。

跑法（需先把两份参照权重下到 _convert_tmp/，见 HANDOFF）：
    uv run --no-sync python scripts/convert_florence2_native.py
耗时：CPU 上 1-2 分钟。
"""

from __future__ import annotations

import hashlib
import json
import shutil
import sys
from pathlib import Path

import torch
from safetensors.torch import load_file

VISION_DIR = Path("D:/ASTR/embodiments/vision/omniparser_v2")
CAP_DIR = VISION_DIR / "icon_caption"
TMP = VISION_DIR / "_convert_tmp"
OUT_DIR = VISION_DIR / "icon_caption_native"
OLD_VOCAB, NEW_VOCAB = 51289, 51328


def fingerprint(t: torch.Tensor) -> str:
    """fp16 字节哈希——两份参照权重只差 dtype（fp32→fp16 cast），统一成 fp16 再比。"""
    return hashlib.sha256(t.to(torch.float16).contiguous().numpy().tobytes()).hexdigest()


def build_mapping() -> tuple[dict[str, str], set[str]]:
    """旧名→新名映射：数值指纹相等 + 形状一致，断言双向无歧义。"""
    ms = load_file(TMP / "ms_base_ft.safetensors")
    community = load_file(TMP / "community_native.safetensors")

    fp_to_old: dict[str, list[str]] = {}
    for k, t in ms.items():
        fp_to_old.setdefault(fingerprint(t), []).append(k)

    mapping: dict[str, str] = {}
    transposed: set[str] = set()
    unmatched: list[str] = []
    for nk, nt in community.items():
        if nt.shape and nt.shape[0] == NEW_VOCAB:  # 扩容过的 embed/lm_head：只比原有行
            nt = nt[:OLD_VOCAB]
        olds = fp_to_old.get(fingerprint(nt), [])
        if not olds and nt.ndim == 2:
            # 原版裸 Parameter（x @ W 用法）在原生实现里包成 nn.Linear，权重存转置
            olds = fp_to_old.get(fingerprint(nt.T), [])
            if len(olds) == 1:
                transposed.add(olds[0])
        if len(olds) == 1:
            mapping[olds[0]] = nk
        else:
            unmatched.append(f"{nk} -> {len(olds)} candidates")
    print("transposed params:", transposed or "none")
    if unmatched:
        print("数值指纹未唯一匹配的张量：", *unmatched, sep="\n  ")
        raise SystemExit(1)
    return mapping, transposed


def convert() -> None:
    mapping, transposed = build_mapping()
    community = load_file(TMP / "community_native.safetensors")
    finetune = load_file(CAP_DIR / "model.safetensors")

    # OmniParser 微调把 lm_head 和 shared 练分叉了（原版代码未真正绑定），
    # 忠实转换须解绑保留两份；参照权重是 tied 的所以映射里没有 lm_head，手工补。
    shared_extra = community["model.language_model.shared.weight"][OLD_VOCAB:]
    mapping["language_model.lm_head.weight"] = "lm_head.weight"

    out: dict[str, torch.Tensor] = {}
    dropped = []
    for ok, t in finetune.items():
        nk = mapping.get(ok)
        if nk is None:
            dropped.append(ok)
            continue
        if ok in transposed:
            t = t.T.contiguous()
        ref_rows = community[nk].shape[0] if nk in community else NEW_VOCAB
        if t.shape and t.shape[0] == OLD_VOCAB and ref_rows == NEW_VOCAB:
            t = torch.cat([t, shared_extra.to(t.dtype)], dim=0)
        out[nk] = t.to(torch.float16)
    # tie_word_embeddings=False 也解开了 embed_tokens↔shared——原模型这俩确实共享，补副本
    for k in (
        "model.language_model.encoder.embed_tokens.weight",
        "model.language_model.decoder.embed_tokens.weight",
    ):
        out[k] = out["model.language_model.shared.weight"]
    print(f"mapped {len(out)}/{len(finetune)}，dropped: {dropped}")
    # final_logits_bias 原生实现已移除——必须全零才能安全丢弃
    assert dropped == ["language_model.final_logits_bias"], f"意外丢弃: {dropped}"
    assert not finetune["language_model.final_logits_bias"].any(), "final_logits_bias 非零！"

    # strict 加载进原生类 = 全量键名+形状校验
    from transformers import Florence2Config, Florence2ForConditionalGeneration

    cfg = Florence2Config.from_pretrained(CAP_DIR / "native_ref")
    cfg.dtype = "float16"
    cfg.tie_word_embeddings = False
    cfg.text_config.tie_word_embeddings = False
    model = Florence2ForConditionalGeneration(cfg)
    model.load_state_dict(out, strict=True)
    # 确认解绑生效：tying 若仍启用会让 lm_head 被 shared 覆盖
    assert not torch.equal(
        model.lm_head.weight, model.model.language_model.shared.weight
    ), "lm_head 被绑定覆盖，解绑未生效"

    OUT_DIR.mkdir(exist_ok=True)
    model.half().save_pretrained(OUT_DIR)
    shutil.copy2(
        CAP_DIR / "native_ref" / "generation_config.json", OUT_DIR / "generation_config.json"
    )
    print("saved ->", OUT_DIR)
    print(json.dumps({"tensors": len(out), "vocab": NEW_VOCAB}, ensure_ascii=False))


if __name__ == "__main__":
    sys.exit(convert())
