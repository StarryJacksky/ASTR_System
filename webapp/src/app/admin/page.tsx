import type { Metadata } from "next";

import { ControlAtlas } from "@/features/control/components/ControlAtlas";

export const metadata: Metadata = {
  title: "主权档案索引 · ASTR Control",
};

export default function ControlIndexPage() {
  return <ControlAtlas variant="page" />;
}
