"""OmniParser-v2 感知件（P2-W6）：纯逻辑单测（框合并/坐标映射/工厂回落），不碰重依赖。"""

from __future__ import annotations

from astr.effector.cu_engine import StubPerceiver
from astr.effector.omni_perceiver import (
    build_perceiver,
    merge_boxes,
    to_ui_elements,
    weights_ready,
)


def test_merge_boxes_absorbs_contained_ocr() -> None:
    icons = [(100.0, 100.0, 300.0, 160.0), (400.0, 100.0, 460.0, 160.0)]
    ocr = [
        ((120.0, 115.0, 280.0, 145.0), "发送"),  # 完全落在图标框 0 内 → 吸收
        ((10.0, 10.0, 90.0, 40.0), "文件名.txt"),  # 独立文本
    ]
    elements, need_caption = merge_boxes(icons, ocr)
    labels = {lab for _, lab in elements}
    assert "文件名.txt" in labels  # 独立 OCR 成元素
    assert "发送" in labels  # 图标框 0 得到文本标签
    assert need_caption == [1]  # 图标框 1 无文字 → 留给 Florence


def test_merge_boxes_partial_overlap_not_absorbed() -> None:
    icons = [(100.0, 100.0, 200.0, 200.0)]
    # 只有一小角搭在图标框上（containment < 0.8）→ 不吸收，独立成元素
    ocr = [((180.0, 180.0, 400.0, 220.0), "跨界文本")]
    elements, need_caption = merge_boxes(icons, ocr)
    assert [lab for _, lab in elements] == ["跨界文本"]
    assert need_caption == [0]


def test_to_ui_elements_center_and_filtering() -> None:
    labeled = [
        ((100.0, 100.0, 300.0, 200.0), "确定"),
        ((0.0, 0.0, 10.0, 10.0), "   "),  # 空标签丢弃
        ((0.0, 0.0, 10.0, 10.0), "长" * 100),  # 截断到 80
    ]
    els = to_ui_elements(labeled)
    assert len(els) == 2
    assert (els[0].x, els[0].y, els[0].w, els[0].h) == (200, 150, 200, 100)
    assert len(els[1].label) == 80


def test_build_perceiver_falls_back_to_stub(tmp_path) -> None:
    assert not weights_ready(tmp_path)
    p = build_perceiver(tmp_path)
    assert isinstance(p, StubPerceiver)  # 权重缺失 → 指引型占位，不装死
