import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import StudioPage, { metadata } from "./page";

describe("Studio unavailable route", () => {
  it("publishes truthful unavailable metadata", () => {
    expect(metadata).toEqual({
      title: "Studio 投影未启用 · 星枢 ASTR",
      description: "星枢 Studio 当前仅展示未启用边界，不提供工作区、Run 或产物能力。",
    });
  });

  it("renders the unavailable workplane as the page content", () => {
    render(<StudioPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Studio 投影未启用" }),
    ).toBeVisible();
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
  });
});
