import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { WorkflowBrowserView } from "@/components/quickstart/WorkflowBrowserView";

describe("WorkflowBrowserView in hosted mode", () => {
  afterEach(() => vi.restoreAllMocks());

  it("lists managed workflows without showing native folder controls or a server path", async () => {
    const mockFetch = vi.fn((url: string) => {
      if (url === "/api/capabilities") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ hosted: true, managedStorage: true, configured: true }),
        });
      }
      if (url === "/api/list-workflows") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            workflows: [{
              name: "Managed sample",
              directoryPath: "opaque-project-id",
              relativePath: "Managed sample",
              lastModified: Date.now(),
            }],
          }),
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", mockFetch);

    render(<WorkflowBrowserView onWorkflowLoaded={vi.fn()} />);

    expect(await screen.findByText("Projects saved in managed server storage")).toBeInTheDocument();
    expect((await screen.findAllByText("Managed sample")).length).toBeGreaterThan(0);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith("/api/list-workflows"));
    expect(screen.queryByText("Open from directory")).not.toBeInTheDocument();
    expect(screen.queryByText("Change folder")).not.toBeInTheDocument();
    expect(screen.queryByText("Choose folder")).not.toBeInTheDocument();
  });
});
