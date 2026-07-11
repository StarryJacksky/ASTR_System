import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { VoiceprintPanel } from "./VoiceprintPanel";

describe("VoiceprintPanel", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("does not claim that the web transcription path verifies the enrolled speaker", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: async () => ({
          enrolled: true,
          model_available: true,
          threshold: 0.7,
          require: true,
        }),
      }),
    );

    render(<VoiceprintPanel />);

    expect(
      await screen.findByText("已注册声纹模板；当前网页转写入口未执行身份验证"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/只认你的声音|只认主人/)).not.toBeInTheDocument();
  });

  it("keeps its source documentation honest about the unverified web voice path", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/astr/VoiceprintPanel.tsx"),
      "utf8",
    );

    expect(source).not.toMatch(/语音入口据此升 L2|网页语音入口.*L2/);
    expect(source).toContain("网页转写入口不执行说话者身份验证");
  });
});
