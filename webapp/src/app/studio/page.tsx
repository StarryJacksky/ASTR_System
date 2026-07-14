import type { Metadata } from "next";

import { StudioUnavailableWorkplane } from "@/features/studio/components/StudioUnavailableWorkplane";

export const metadata: Metadata = {
  title: "Studio 投影未启用 · 星枢 ASTR",
  description: "星枢 Studio 当前仅展示未启用边界，不提供工作区、Run 或产物能力。",
};

export default function StudioPage() {
  return <StudioUnavailableWorkplane />;
}
