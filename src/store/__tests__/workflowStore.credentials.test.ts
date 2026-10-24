import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { defaultProviderSettings } from "../utils/localStorage";

let useWorkflowStore: typeof import("../workflowStore")["useWorkflowStore"];
const browserStorage: Record<string, string> = {};

beforeAll(async () => {
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => browserStorage[key] ?? null,
    setItem: (key: string, value: string) => { browserStorage[key] = value; },
    removeItem: (key: string) => { delete browserStorage[key]; },
  });
  ({ useWorkflowStore } = await import("../workflowStore"));
});

const createObjectURL = vi.fn(() => "blob:test-workflow");
const revokeObjectURL = vi.fn();
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

describe("workflow credential export", () => {
  afterEach(() => {
    useWorkflowStore.setState({ nodes: [], edges: [], providerSettings: defaultProviderSettings });
    if (originalCreateObjectURL) {
      Object.defineProperty(URL, "createObjectURL", { configurable: true, value: originalCreateObjectURL });
    } else {
      delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
    }
    if (originalRevokeObjectURL) {
      Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: originalRevokeObjectURL });
    } else {
      delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not include provider keys in exported workflow JSON", () => {
    let contents = "";
    vi.stubGlobal("Blob", class {
      constructor(parts: string[]) {
        contents = parts.join("");
      }
    });
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    useWorkflowStore.setState({
      nodes: [],
      edges: [],
      providerSettings: {
        providers: {
          ...defaultProviderSettings.providers,
          gemini: { ...defaultProviderSettings.providers.gemini, apiKey: "private-tab-key" },
        },
      },
    });

    useWorkflowStore.getState().saveWorkflow("Credential-free export");

    expect(createObjectURL).toHaveBeenCalled();
    expect(contents).not.toContain("private-tab-key");
    expect(JSON.parse(contents)).not.toHaveProperty("providerSettings");
  });
});
