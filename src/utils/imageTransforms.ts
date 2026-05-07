/**
 * Local image transform helpers for deterministic image-processing nodes.
 */

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

async function loadImageForCanvas(src: string): Promise<{ image: HTMLImageElement; cleanup: () => void }> {
  let objectUrl: string | null = null;
  let resolvedSrc = src;

  if (!src.startsWith("data:")) {
    const response = await fetch(src);
    if (!response.ok) {
      throw new Error(`Failed to load image: ${response.status}`);
    }
    const blob = await response.blob();
    objectUrl = URL.createObjectURL(blob);
    resolvedSrc = objectUrl;
  }

  return new Promise((resolve, reject) => {
    const image = new Image();

    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };

    image.onload = () => resolve({ image, cleanup });
    image.onerror = () => {
      cleanup();
      reject(new Error("Failed to decode image"));
    };
    image.src = resolvedSrc;
  });
}

export async function cropImage(
  src: string,
  crop: { x: number; y: number; width: number; height: number; aspectRatio?: string },
): Promise<string> {
  const { image, cleanup } = await loadImageForCanvas(src);

  try {
    const sourceWidth = image.naturalWidth;
    const sourceHeight = image.naturalHeight;

    let cropX: number;
    let cropY: number;
    let cropWidth: number;
    let cropHeight: number;

    if (crop.aspectRatio && crop.aspectRatio !== "original") {
      const [w, h] = crop.aspectRatio.split(":").map(Number);
      const targetRatio = w / h;
      const sourceRatio = sourceWidth / sourceHeight;

      if (sourceRatio > targetRatio) {
        cropHeight = sourceHeight;
        cropWidth = Math.round(sourceHeight * targetRatio);
      } else {
        cropWidth = sourceWidth;
        cropHeight = Math.round(sourceWidth / targetRatio);
      }

      cropX = Math.round((sourceWidth - cropWidth) / 2);
      cropY = Math.round((sourceHeight - cropHeight) / 2);
    } else {
      cropX = clamp(Math.round((crop.x / 100) * sourceWidth), 0, Math.max(0, sourceWidth - 1));
      cropY = clamp(Math.round((crop.y / 100) * sourceHeight), 0, Math.max(0, sourceHeight - 1));
      cropWidth = clamp(
        Math.round((crop.width / 100) * sourceWidth),
        1,
        Math.max(1, sourceWidth - cropX),
      );
      cropHeight = clamp(
        Math.round((crop.height / 100) * sourceHeight),
        1,
        Math.max(1, sourceHeight - cropY),
      );
    }

    const canvas = document.createElement("canvas");
    canvas.width = cropWidth;
    canvas.height = cropHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Could not get canvas 2D context");
    }

    ctx.drawImage(
      image,
      cropX,
      cropY,
      cropWidth,
      cropHeight,
      0,
      0,
      cropWidth,
      cropHeight,
    );

    return canvas.toDataURL("image/png");
  } finally {
    cleanup();
  }
}

export async function resizeImage(
  src: string,
  options: { width: number; height: number; keepAspectRatio: boolean },
): Promise<string> {
  const { image, cleanup } = await loadImageForCanvas(src);

  try {
    const targetWidth = Math.max(1, Math.round(options.width));
    const targetHeight = Math.max(1, Math.round(options.height));

    let outputWidth = targetWidth;
    let outputHeight = targetHeight;

    if (options.keepAspectRatio) {
      const scale = Math.min(targetWidth / image.naturalWidth, targetHeight / image.naturalHeight);
      outputWidth = Math.max(1, Math.round(image.naturalWidth * scale));
      outputHeight = Math.max(1, Math.round(image.naturalHeight * scale));
    }

    const canvas = document.createElement("canvas");
    canvas.width = outputWidth;
    canvas.height = outputHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Could not get canvas 2D context");
    }

    ctx.drawImage(image, 0, 0, outputWidth, outputHeight);
    return canvas.toDataURL("image/png");
  } finally {
    cleanup();
  }
}
