import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  executeCrop,
  executeResize,
  executeUpscale,
  executeRemoveBg,
} from "../imageTransformExecutors";
import type { NodeExecutionContext } from "../types";
import type { WorkflowNode } from "@/types";

vi.mock("@/utils/imageTransforms", () => ({
  cropImage: vi.fn(),
  resizeImage: vi.fn(),
}));

import { cropImage, resizeImage } from "@/utils/imageTransforms";

function makeNode(id: string, type: string, data: Record<string, unknown>): WorkflowNode {
  return { id, type, position: { x: 0, y: 0 }, data } as WorkflowNode;
}

function makeCtx(
  node: WorkflowNode,
  overrides: Partial<NodeExecutionContext> = {},
): NodeExecutionContext {
  return {
    node,
    getConnectedInputs: vi.fn().mockReturnValue({
      images: [],
      videos: [],
      audio: [],
      model3d: null,
      text: null,
      textItems: [],
      dynamicInputs: {},
      easeCurve: null,
    }),
    updateNodeData: vi.fn(),
    getFreshNode: vi.fn().mockReturnValue(node),
    getEdges: vi.fn().mockReturnValue([]),
    getNodes: vi.fn().mockReturnValue([]),
    providerSettings: { providers: {} as never } as NodeExecutionContext["providerSettings"],
    addIncurredCost: vi.fn(),
    addToGlobalHistory: vi.fn(),
    generationsPath: null,
    saveDirectoryPath: null,
    trackSaveGeneration: vi.fn(),
    appendOutputGalleryImage: vi.fn(),
    get: vi.fn(),
    ...overrides,
  };
}

describe("imageTransformExecutors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("executes crop with the connected image", async () => {
    vi.mocked(cropImage).mockResolvedValue("cropped-image");
    const node = makeNode("crop-1", "crop", {
      inputImages: [],
      outputImage: null,
      x: 10,
      y: 20,
      width: 60,
      height: 50,
      status: "idle",
      error: null,
    });
    const ctx = makeCtx(node, {
      getConnectedInputs: vi.fn().mockReturnValue({
        images: ["input-image"],
        videos: [],
        audio: [],
        model3d: null,
        text: null,
        textItems: [],
        dynamicInputs: {},
        easeCurve: null,
      }),
    });

    await executeCrop(ctx);

    expect(cropImage).toHaveBeenCalledWith("input-image", expect.objectContaining({
      x: 10,
      y: 20,
      width: 60,
      height: 50,
    }));
    expect(ctx.updateNodeData).toHaveBeenCalledWith("crop-1", expect.objectContaining({
      inputImages: ["input-image"],
      status: "loading",
      error: null,
    }));
    expect(ctx.updateNodeData).toHaveBeenCalledWith("crop-1", expect.objectContaining({
      outputImage: "cropped-image",
      status: "complete",
      error: null,
    }));
  });

  it("executes resize with stored fallback input when requested", async () => {
    vi.mocked(resizeImage).mockResolvedValue("resized-image");
    const node = makeNode("resize-1", "resize", {
      inputImages: ["stored-image"],
      outputImage: null,
      width: 800,
      height: 600,
      keepAspectRatio: false,
      status: "idle",
      error: null,
    });
    const ctx = makeCtx(node);

    await executeResize(ctx, { useStoredFallback: true });

    expect(resizeImage).toHaveBeenCalledWith("stored-image", {
      width: 800,
      height: 600,
      keepAspectRatio: false,
    });
  });

  it("executes upscale through fal generate API", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, image: "upscaled-image" }),
    } as Response);

    const node = makeNode("upscale-1", "upscale", {
      inputImages: [],
      outputImage: null,
      model: "Standard V2",
      upscaleFactor: 2,
      faceEnhancement: true,
      subjectDetection: "All",
      status: "idle",
      error: null,
    });
    const ctx = makeCtx(node, {
      getConnectedInputs: vi.fn().mockReturnValue({
        images: ["input-image"],
        videos: [],
        audio: [],
        model3d: null,
        text: null,
        textItems: [],
        dynamicInputs: {},
        easeCurve: null,
      }),
    });

    await executeUpscale(ctx);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/generate",
      expect.objectContaining({
        method: "POST",
      }),
    );
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body.selectedModel).toEqual(expect.objectContaining({
      provider: "fal",
      modelId: "fal-ai/topaz/upscale/image",
    }));
    expect(body.parameters).toEqual(expect.objectContaining({
      model: "Standard V2",
      upscale_factor: 2,
      face_enhancement: true,
      subject_detection: "All",
    }));
    expect(ctx.updateNodeData).toHaveBeenLastCalledWith("upscale-1", expect.objectContaining({
      outputImage: "upscaled-image",
      status: "complete",
    }));
  });

  it("fails removeBg when no image input is available", async () => {
    const node = makeNode("remove-1", "removeBg", {
      inputImages: [],
      outputImage: null,
      model: "General Use (Light)",
      operatingResolution: "1024x1024",
      refineForeground: true,
      status: "idle",
      error: null,
    });
    const ctx = makeCtx(node);

    await expect(executeRemoveBg(ctx)).rejects.toThrow("Missing image input");
    expect(ctx.updateNodeData).toHaveBeenCalledWith("remove-1", {
      status: "error",
      error: "Missing image input",
    });
  });
});
