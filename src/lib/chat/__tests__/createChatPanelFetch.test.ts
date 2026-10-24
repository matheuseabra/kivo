import { describe, expect, it, vi } from "vitest";
import { createChatPanelFetch } from "../createChatPanelFetch";
import { setProviderApiKey } from "@/store/utils/providerCredentials";

describe("createChatPanelFetch", () => {
  it("reads the latest tab key and workflow refs for every request", async () => {
    const workflowState = { current: { nodes: ["first"] } };
    const selectedNodeIds = { current: ["node-first"] };
    const fetcher = vi.fn().mockResolvedValue(new Response("{}"));
    const request = createChatPanelFetch(workflowState, selectedNodeIds, fetcher);

    setProviderApiKey("gemini", "tab-key-one");
    await request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [] }),
    });

    workflowState.current = { nodes: ["second"] };
    selectedNodeIds.current = ["node-second"];
    setProviderApiKey("gemini", "tab-key-two");
    await request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [] }),
    });

    const firstRequest = fetcher.mock.calls[0][1] as RequestInit;
    const secondRequest = fetcher.mock.calls[1][1] as RequestInit;
    expect(new Headers(firstRequest.headers).get("X-Gemini-API-Key")).toBe("tab-key-one");
    expect(new Headers(firstRequest.headers).get("Content-Type")).toBe("application/json");
    expect(new Headers(secondRequest.headers).get("X-Gemini-API-Key")).toBe("tab-key-two");
    expect(JSON.parse(secondRequest.body as string)).toMatchObject({
      workflowState: { nodes: ["second"] },
      selectedNodeIds: ["node-second"],
    });
    setProviderApiKey("gemini", null);
  });

  it("preserves headers from a Request input", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("{}"));
    const request = createChatPanelFetch({ current: undefined }, { current: undefined }, fetcher);
    setProviderApiKey("gemini", "request-tab-key");
    await request(new Request("https://example.test/api/chat", { headers: { "X-Existing": "keep" } }));

    const init = fetcher.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get("X-Existing")).toBe("keep");
    expect(new Headers(init.headers).get("X-Gemini-API-Key")).toBe("request-tab-key");
    setProviderApiKey("gemini", null);
  });
});
