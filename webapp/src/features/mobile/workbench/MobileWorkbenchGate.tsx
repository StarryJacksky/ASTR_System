import type { ReactNode } from "react";

import { CapabilityGate } from "../shared/CapabilityGate";

const WORKBENCH_CAPABILITIES = Object.freeze([
  "Workspace",
  "Run",
  "Tool",
  "Trace",
  "Source",
  "Artifact",
]);

export function MobileWorkbenchGate(): ReactNode {
  return (
    <CapabilityGate
      capabilities={WORKBENCH_CAPABILITIES}
      evidence="没有可验证的 Run、模型路由、成本或产物数据。"
      eyebrow="WORKBENCH / CAPABILITY BOUNDARY"
      reason="缺少已授权 authority、认证 scopes 与只读 endpoints"
      status="Studio 投影未启用"
      title="AI 工作台"
    />
  );
}
