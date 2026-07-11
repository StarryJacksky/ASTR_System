import { describe, expect, it } from "vitest";

import { CSS_GREEN_HUE_NAMES, findForbiddenGreenUsages } from "./no-green-scanner";

describe("no-green source scanner", () => {
  it.each(CSS_GREEN_HUE_NAMES)("rejects the CSS named green %s in quoted and bare color values", (name) => {
    expect(findForbiddenGreenUsages(`const value = "${name}";`)).not.toEqual([]);
    expect(findForbiddenGreenUsages(`.sample { color: ${name}; }`)).not.toEqual([]);
  });

  it.each([
    "#00ff00",
    "rgb(0, 255, 0)",
    "rgb(0 255 0)",
    "hsl(120, 100%, 50%)",
    "hsl(120 100% 50%)",
    "[0x00, 0xff, 0x00]",
    "bg-green-500",
  ])("rejects the hard-coded green form %s", (value) => {
    expect(findForbiddenGreenUsages(value)).not.toEqual([]);
  });

  it("ignores comments, URLs, browser prose, and blue action colors", () => {
    expect(
      findForbiddenGreenUsages(
        '// color: green\nconst copy = "evergreen browser";\nconst url = "https://green.example";\nconst action = "#8bcfff"; /* darkgreen */',
      ),
    ).toEqual([]);
  });
});
