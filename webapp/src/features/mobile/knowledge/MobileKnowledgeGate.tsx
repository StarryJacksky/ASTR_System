import type { ReactNode } from "react";

import { CapabilityGate } from "../shared/CapabilityGate";

export function MobileKnowledgeGate(): ReactNode {
  return (
    <CapabilityGate
      evidence="未来只回答哪些结果值得长期保留与检索；当前不展示任何知识事实。"
      eyebrow="KNOWLEDGE / READ PROJECTION"
      reason="尚无已授权、可验证的知识只读端点"
      status="安全只读知识投影未启用。"
      title="知识"
    />
  );
}
