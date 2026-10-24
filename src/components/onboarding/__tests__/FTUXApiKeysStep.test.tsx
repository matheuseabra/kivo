import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FTUXApiKeysStep } from "../FTUXApiKeysStep";

const mocks = vi.hoisted(() => ({
  updateProviderApiKey: vi.fn(),
  providerSettings: {
    providers: {
      gemini: { apiKey: null },
      openai: { apiKey: null },
      anthropic: { apiKey: null },
      replicate: { apiKey: null },
      fal: { apiKey: null },
      kie: { apiKey: null },
      wavespeed: { apiKey: null },
    },
  },
}));

vi.mock("@/store/workflowStore", () => ({
  useWorkflowStore: (selector: (state: unknown) => unknown) =>
    selector({
      updateProviderApiKey: mocks.updateProviderApiKey,
      providerSettings: mocks.providerSettings,
    }),
}));

describe("FTUXApiKeysStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({ gemini: false, openai: false, anthropic: false, replicate: false, fal: false, kie: false, wavespeed: false }),
    }));
  });

  it("labels user keys as tab-only, unverified, and supports clearing them", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({ gemini: true, openai: false, anthropic: false, replicate: false, fal: false, kie: false, wavespeed: false }),
    }));
    render(<FTUXApiKeysStep />);
    const keyInput = screen.getByLabelText("Google Gemini API key");
    await waitFor(() => expect(screen.getByText("Server key configured · not verified")).toBeInTheDocument());
    fireEvent.change(keyInput, { target: { value: "tab-only-key" } });

    expect(mocks.updateProviderApiKey).toHaveBeenCalledWith("gemini", "tab-only-key");
    expect(screen.getByText("Saved for this tab · not verified")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Clear Google Gemini API key"));

    expect(mocks.updateProviderApiKey).toHaveBeenLastCalledWith("gemini", null);
    expect(keyInput).toHaveValue("");
  });
});
