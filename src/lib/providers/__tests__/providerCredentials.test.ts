import { afterEach, describe, expect, it } from "vitest";
import { getProvider } from "@/lib/providers";
import "@/lib/providers/fal";
import "@/lib/providers/replicate";
import "@/lib/providers/wavespeed";
import { setProviderApiKey } from "@/store/utils/providerCredentials";

describe("browser provider credentials", () => {
  afterEach(() => {
    setProviderApiKey("fal", null);
    setProviderApiKey("replicate", null);
    setProviderApiKey("wavespeed", null);
  });

  it("supplies tab-memory credentials to provider adapters", () => {
    setProviderApiKey("fal", "fal-tab-key");
    setProviderApiKey("replicate", "replicate-tab-key");
    setProviderApiKey("wavespeed", "wavespeed-tab-key");

    expect(getProvider("fal")?.getApiKey()).toBe("fal-tab-key");
    expect(getProvider("replicate")?.getApiKey()).toBe("replicate-tab-key");
    expect(getProvider("wavespeed")?.getApiKey()).toBe("wavespeed-tab-key");
  });
});
