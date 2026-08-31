import { describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sanitizeNodeOptions } = require("../../scripts/node-options-utils.cjs");

describe("node options sanitization", () => {
  it("removes invalid --r= token", () => {
    const result = sanitizeNodeOptions("--max-old-space-size=4096 --r= --trace-warnings");
    expect(result.valid).toBe(false);
    expect(result.sanitized.includes("--r=")).toBe(false);
    expect(result.sanitized.includes("--max-old-space-size=4096")).toBe(true);
  });
});
