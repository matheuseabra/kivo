import { afterEach, describe, expect, it } from "vitest";
import { GET } from "../route";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("/api/env-status", () => {
  it("does not disclose operator key availability in hosted mode", async () => {
    process.env.KIVO_HOSTED = "true";
    process.env.GEMINI_API_KEY = "operator-secret";
    process.env.REPLICATE_API_KEY = "operator-secret";

    const response = await GET();

    expect(await response.json()).toEqual({
      gemini: false,
      openai: false,
      anthropic: false,
      replicate: false,
      fal: false,
      kie: false,
      wavespeed: false,
    });
  });

  it("keeps local environment status behavior", async () => {
    process.env.KIVO_HOSTED = "false";
    process.env.GEMINI_API_KEY = "local-key";

    const response = await GET();
    const status = await response.json();

    expect(status.gemini).toBe(true);
  });
});
