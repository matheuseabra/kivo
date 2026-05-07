/**
 * Image Transform Executors
 *
 * Local executors for crop/resize and fal-backed executors for upscale/removeBg.
 */

import type {
  CropNodeData,
  RemoveBgNodeData,
  ResizeNodeData,
  SelectedModel,
  UpscaleNodeData,
} from "@/types";
import { buildGenerateHeaders } from "@/store/utils/buildApiHeaders";
import { cropImage, resizeImage } from "@/utils/imageTransforms";
import type { NodeExecutionContext } from "./types";

export interface ImageTransformExecutorOptions {
  useStoredFallback?: boolean;
}

const UPSCALE_MODEL: SelectedModel = {
  provider: "fal",
  modelId: "fal-ai/topaz/upscale/image",
  displayName: "Topaz Upscale",
};

const REMOVE_BG_MODEL: SelectedModel = {
  provider: "fal",
  modelId: "fal-ai/birefnet/v2",
  displayName: "BiRefNet v2",
};

function resolvePrimaryImage(
  connectedImages: string[],
  storedImages: string[] | undefined,
  useStoredFallback: boolean,
): string | null {
  if (connectedImages[0]) {
    return connectedImages[0];
  }
  if (useStoredFallback && storedImages?.[0]) {
    return storedImages[0];
  }
  return null;
}

async function executeLocalTransform(
  ctx: NodeExecutionContext,
  storedImages: string[] | undefined,
  run: (inputImage: string) => Promise<string>,
  options: ImageTransformExecutorOptions = {},
): Promise<void> {
  const { node, getConnectedInputs, updateNodeData } = ctx;
  const { useStoredFallback = false } = options;
  const { images: connectedImages } = getConnectedInputs(node.id);
  const inputImage = resolvePrimaryImage(connectedImages, storedImages, useStoredFallback);

  if (!inputImage) {
    updateNodeData(node.id, {
      status: "error",
      error: "Missing image input",
    });
    throw new Error("Missing image input");
  }

  updateNodeData(node.id, {
    inputImages: [inputImage],
    status: "loading",
    error: null,
  });

  try {
    const outputImage = await run(inputImage);
    updateNodeData(node.id, {
      outputImage,
      status: "complete",
      error: null,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Image transform failed";
    updateNodeData(node.id, {
      status: "error",
      error: errorMessage,
    });
    throw error;
  }
}

async function executeFalImageTransform(
  ctx: NodeExecutionContext,
  storedImages: string[] | undefined,
  selectedModel: SelectedModel,
  parameters: Record<string, unknown>,
  options: ImageTransformExecutorOptions = {},
): Promise<void> {
  const { node, getConnectedInputs, updateNodeData, signal, providerSettings } = ctx;
  const { useStoredFallback = false } = options;
  const { images: connectedImages } = getConnectedInputs(node.id);
  const inputImage = resolvePrimaryImage(connectedImages, storedImages, useStoredFallback);

  if (!inputImage) {
    updateNodeData(node.id, {
      status: "error",
      error: "Missing image input",
    });
    throw new Error("Missing image input");
  }

  updateNodeData(node.id, {
    inputImages: [inputImage],
    status: "loading",
    error: null,
  });

  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: buildGenerateHeaders("fal", providerSettings),
      body: JSON.stringify({
        images: [inputImage],
        prompt: "",
        selectedModel,
        parameters,
      }),
      ...(signal ? { signal } : {}),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok || !result.success || !result.image) {
      const errorMessage =
        typeof result.error === "string"
          ? result.error
          : `HTTP ${response.status}`;
      updateNodeData(node.id, {
        status: "error",
        error: errorMessage,
      });
      throw new Error(errorMessage);
    }

    updateNodeData(node.id, {
      outputImage: result.image,
      status: "complete",
      error: null,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : "Image transform failed";
    updateNodeData(node.id, {
      status: "error",
      error: errorMessage,
    });
    throw error;
  }
}

export async function executeCrop(
  ctx: NodeExecutionContext,
  options: ImageTransformExecutorOptions = {},
): Promise<void> {
  const nodeData = (ctx.getFreshNode(ctx.node.id)?.data || ctx.node.data) as CropNodeData;
  await executeLocalTransform(
    ctx,
    nodeData.inputImages,
    (inputImage) => cropImage(inputImage, nodeData),
    options,
  );
}

export async function executeResize(
  ctx: NodeExecutionContext,
  options: ImageTransformExecutorOptions = {},
): Promise<void> {
  const nodeData = (ctx.getFreshNode(ctx.node.id)?.data || ctx.node.data) as ResizeNodeData;
  await executeLocalTransform(
    ctx,
    nodeData.inputImages,
    (inputImage) =>
      resizeImage(inputImage, {
        width: nodeData.width,
        height: nodeData.height,
        keepAspectRatio: nodeData.keepAspectRatio,
      }),
    options,
  );
}

export async function executeUpscale(
  ctx: NodeExecutionContext,
  options: ImageTransformExecutorOptions = {},
): Promise<void> {
  const nodeData = (ctx.getFreshNode(ctx.node.id)?.data || ctx.node.data) as UpscaleNodeData;
  await executeFalImageTransform(
    ctx,
    nodeData.inputImages,
    UPSCALE_MODEL,
    {
      model: nodeData.model,
      upscale_factor: nodeData.upscaleFactor,
      face_enhancement: nodeData.faceEnhancement,
      subject_detection: nodeData.subjectDetection,
      output_format: "png",
    },
    options,
  );
}

export async function executeRemoveBg(
  ctx: NodeExecutionContext,
  options: ImageTransformExecutorOptions = {},
): Promise<void> {
  const nodeData = (ctx.getFreshNode(ctx.node.id)?.data || ctx.node.data) as RemoveBgNodeData;
  await executeFalImageTransform(
    ctx,
    nodeData.inputImages,
    REMOVE_BG_MODEL,
    {
      model: nodeData.model,
      operating_resolution: nodeData.operatingResolution,
      refine_foreground: nodeData.refineForeground,
      output_format: "png",
    },
    options,
  );
}
