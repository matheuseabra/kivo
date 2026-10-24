import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";
import { logger } from "@/utils/logger";
import { isVercelEnvironment, unsupportedOnVercelResponse } from "@/utils/vercelEnvironment";
import { safeFetchMedia } from "@/lib/server/safeMediaFetch";
import {
  ensureHostedDiskSpace,
  isHostedStorageMode,
  MAX_GENERATION_FILE_BYTES,
  MAX_GENERATION_REQUEST_BYTES,
  readJsonRequest,
  resolveManagedProjectPath,
  toHostedStorageError,
  validateProjectId,
} from "@/lib/hostedStorage";

export const maxDuration = 300; // 5 minute timeout for large media operations

// Helper to get file extension from MIME type
function getExtensionFromMime(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "model/gltf-binary": "glb",
    "model/gltf+json": "gltf",
    "model/obj": "obj",
    "model/vnd.usdz+zip": "usdz",
    "model/fbx": "fbx",
    "model/stl": "stl",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/ogg": "ogg",
    "audio/flac": "flac",
    "audio/aac": "aac",
  };

  // Check explicit mapping first
  if (mimeToExt[mimeType]) {
    return mimeToExt[mimeType];
  }

  // Fallback based on MIME type prefix
  if (mimeType.startsWith("image/")) {
    return "png";
  }
  if (mimeType.startsWith("video/")) {
    return "mp4";
  }
  if (mimeType.startsWith("model/")) {
    return "glb";
  }
  if (mimeType.startsWith("audio/")) {
    return "mp3";
  }

  // Unknown type - use generic binary extension
  return "bin";
}

// Identify URL-like media input so unsupported protocols fail validation instead of becoming base64 bytes.
function isRemoteUrl(str: string): boolean {
  try {
    return new URL(str).protocol !== "data:";
  } catch {
    return false;
  }
}

function isValidHostedPayload(content: string): boolean {
  const encoded = "[A-Za-z0-9+/]+={0,2}";
  const dataUrl = new RegExp(`^data:(?:image/(?:png|jpeg|gif|webp|svg\\+xml)|video/(?:mp4|webm|quicktime)|model/(?:gltf-binary|gltf\\+json|obj|fbx|stl|vnd\\.usdz\\+zip)|audio/(?:mpeg|wav|ogg|flac|aac));base64,${encoded}$`);
  return (isRemoteUrl(content) && /^https?:\/\//i.test(content)) || dataUrl.test(content) || new RegExp(`^${encoded}$`).test(content);
}

// Known file extensions for 3D models and common media
const KNOWN_3D_EXTENSIONS = new Set(["glb", "gltf", "obj", "fbx", "usdz", "stl", "ply"]);
const KNOWN_MEDIA_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "mp4", "webm", "mov"]);

// Helper to extract a recognized file extension from a URL pathname
export function getExtensionFromUrl(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const lastDot = pathname.lastIndexOf(".");
    if (lastDot === -1 || lastDot === pathname.length - 1) return null;
    const ext = pathname.substring(lastDot + 1).toLowerCase();
    if (KNOWN_3D_EXTENSIONS.has(ext) || KNOWN_MEDIA_EXTENSIONS.has(ext)) return ext;
    return null;
  } catch {
    return null;
  }
}

// Helper to compute MD5 hash of buffer content
function computeContentHash(buffer: Buffer): string {
  return crypto.createHash("md5").update(buffer).digest("hex");
}

// Helper to find existing file by hash suffix
async function findExistingFileByHash(
  directoryPath: string,
  hash: string,
  extension: string
): Promise<string | null> {
  try {
    const files = await fs.readdir(directoryPath);
    // Look for files ending with this hash before extension
    const hashSuffix = `_${hash}.${extension}`;
    const matching = files.find((f) => f.endsWith(hashSuffix));
    return matching || null;
  } catch {
    return null;
  }
}

// POST: Save a generated image or video to the generations folder (or outputs folder)
export async function POST(request: NextRequest) {
  if (isVercelEnvironment()) {
    return unsupportedOnVercelResponse("Saving generated media to the local filesystem");
  }

  let directoryPath: string | undefined;
  let logDirectoryPath: string | undefined;
  const hosted = isHostedStorageMode();
  try {
    const body = hosted
      ? await readJsonRequest<Record<string, any>>(request, MAX_GENERATION_REQUEST_BYTES)
      : await request.json();
    directoryPath = body.directoryPath;
    const folder = body.folder;
    const image = body.image;
    const video = body.video;
    const model3d = body.model3d;
    const audio = body.audio;
    const prompt = body.prompt;
    const imageId = body.imageId; // Optional ID for carousel support
    const customFilename = body.customFilename; // Optional custom filename (without extension)
    const createDirectory = body.createDirectory; // Optional flag to create directory if it doesn't exist
    logDirectoryPath = hosted && !validateProjectId(directoryPath) ? undefined : directoryPath;

    const isVideo = !!video;
    const isModel = !!model3d;
    const isAudio = !!audio;
    const content = video || model3d || audio || image;

    if (hosted && (folder !== undefined && folder !== "generations")) {
      return NextResponse.json({ success: false, error: "Invalid generation folder" }, { status: 400 });
    }

    logger.info('file.save', 'Generation auto-save request received', {
      directoryPath: logDirectoryPath,
      hasImage: !!image,
      hasVideo: !!video,
      hasModel3d: !!model3d,
      hasAudio: !!audio,
      prompt: hosted ? undefined : prompt,
      customFilename,
    });

    if (!directoryPath || !content) {
      logger.warn('file.save', 'Generation save validation failed: missing fields', {
        hasDirectoryPath: !!directoryPath,
        hasContent: !!content,
      });
      return NextResponse.json(
        { success: false, error: "Missing required fields" },
        { status: 400 }
      );
    }

    if (hosted && (!validateProjectId(directoryPath) || typeof content !== "string" || !isValidHostedPayload(content))) {
      return NextResponse.json({ success: false, error: "Invalid project ID or media content" }, { status: 400 });
    }
    if (hosted && prompt !== undefined && (typeof prompt !== "string" || prompt.length > 4096)) {
      return NextResponse.json({ success: false, error: "Invalid prompt" }, { status: 400 });
    }
    if (hosted && imageId !== undefined && (typeof imageId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$/.test(imageId))) {
      return NextResponse.json({ success: false, error: "Invalid media ID" }, { status: 400 });
    }
    if (hosted && customFilename !== undefined && (typeof customFilename !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(customFilename))) {
      return NextResponse.json({ success: false, error: "Invalid custom filename" }, { status: 400 });
    }

    const generationDirectory = hosted
      ? await resolveManagedProjectPath(directoryPath, "generations")
      : folder === "generations"
        ? path.join(directoryPath, "generations")
        : directoryPath;
    if (hosted) {
      await fs.mkdir(generationDirectory, { recursive: true });
      await resolveManagedProjectPath(directoryPath, "generations");
    } else {
      try {
        const stats = await fs.stat(generationDirectory);
        if (!stats.isDirectory()) {
          return NextResponse.json({ success: false, error: "Path is not a directory" }, { status: 400 });
        }
      } catch {
        if (!createDirectory) {
          return NextResponse.json({ success: false, error: "Directory does not exist" }, { status: 400 });
        }
        try {
          await fs.mkdir(generationDirectory, { recursive: true });
        } catch (mkdirError) {
          logger.error('file.error', 'Failed to create output directory', { directoryPath: logDirectoryPath }, mkdirError instanceof Error ? mkdirError : undefined);
          return NextResponse.json({ success: false, error: "Failed to create output directory" }, { status: 500 });
        }
      }
    }

    let buffer: Buffer;
    let extension: string;

    if (isRemoteUrl(content)) {
      // Handle HTTP URL (common for large video files from providers)
      logger.info('file.save', 'Fetching content from URL', { hasRemoteMedia: true });

      // Set up timeout to prevent hanging requests (60 seconds for large video files)
      const FETCH_TIMEOUT_MS = 60000;
      const MAX_CONTENT_SIZE = 100 * 1024 * 1024; // 100 MiB, aligned with generation storage limit

      const mediaKind = isModel ? "model" : isAudio ? "audio" : isVideo ? "video" : "image";
      const downloaded = await safeFetchMedia(content, {
        kind: mediaKind,
        maxBytes: hosted ? MAX_GENERATION_FILE_BYTES : MAX_CONTENT_SIZE,
        timeoutMs: FETCH_TIMEOUT_MS,
      });
      buffer = downloaded.buffer;

      // For 3D models, URL extensions are the most reliable CDN hint.
      const urlExtension = isModel ? getExtensionFromUrl(content) : null;
      extension = urlExtension || getExtensionFromMime(downloaded.contentType);
    } else {
      // Handle base64 data URL
      const dataUrlMatch = content.match(/^data:([\w/+-]+);base64,/);
      if (dataUrlMatch) {
        const mimeType = dataUrlMatch[1];
        extension = getExtensionFromMime(mimeType);
        const base64Data = content.replace(/^data:[\w/+-]+;base64,/, "");
        buffer = Buffer.from(base64Data, "base64");
      } else {
        // Fallback: assume it's raw base64 without data URL prefix
        extension = isAudio ? "mp3" : isVideo ? "mp4" : "png";
        buffer = Buffer.from(content, "base64");
      }
    }

    if (hosted && (buffer.length === 0 || buffer.length > MAX_GENERATION_FILE_BYTES)) {
      return NextResponse.json({ success: false, error: "Generation file must be between 1 byte and 100 MiB" }, { status: 413 });
    }

    // Safety net: if extension resolved to "bin" but we know the media type, use correct extension
    if (extension === "bin") {
      if (isModel && isRemoteUrl(content)) {
        extension = getExtensionFromUrl(content) || "glb";
      } else {
        extension = isModel ? "glb" : isAudio ? "mp3" : isVideo ? "mp4" : "png";
      }
    }

    // Compute content hash for deduplication
    const contentHash = computeContentHash(buffer);

    // Check for existing file with same hash (deduplication)
    const existingFile = await findExistingFileByHash(generationDirectory, contentHash, extension);
    if (existingFile) {
      const existingPath = hosted
        ? await resolveManagedProjectPath(directoryPath, "generations", existingFile)
        : path.join(generationDirectory, existingFile);
      if (hosted && !(await fs.stat(existingPath)).isFile()) {
        return NextResponse.json({ success: false, error: "Invalid generation file" }, { status: 400 });
      }
      const responsePath = hosted ? `${directoryPath}/generations/${existingFile}` : existingPath;
      logger.info('file.save', 'Generation deduplicated: existing file found', {
        contentHash,
        existingFile,
        filePath: responsePath,
      });

      return NextResponse.json({
        success: true,
        filePath: responsePath,
        filename: existingFile,
        imageId: existingFile.replace(`.${extension}`, ''),
        isDuplicate: true,
      });
    }

    // Generate filename - use custom filename if provided, otherwise use prompt snippet
    let filename: string;
    if (customFilename) {
      // Sanitize custom filename
      const sanitizedFilename = customFilename
        .replace(/[^a-zA-Z0-9-_]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "");
      filename = `${sanitizedFilename}_${contentHash}.${extension}`;
    } else {
      const promptSnippet = prompt
        ? prompt
            .slice(0, 30)
            .replace(/[^a-zA-Z0-9]/g, "_")
            .replace(/_+/g, "_")
            .replace(/^_|_$/g, "")
            .toLowerCase()
        : "generation";
      filename = `${promptSnippet}_${contentHash}.${extension}`;
    }
    const filePath = hosted
      ? await resolveManagedProjectPath(directoryPath, "generations", filename)
      : path.join(generationDirectory, filename);

    if (hosted) await ensureHostedDiskSpace(buffer.length);

    // Write the file
    await fs.writeFile(filePath, buffer);

    logger.info('file.save', 'Generation auto-saved successfully', {
      filePath: hosted ? `${directoryPath}/generations/${filename}` : filePath,
      filename,
      fileSize: buffer.length,
      isVideo,
      isModel,
      isAudio,
      contentHash,
    });

    return NextResponse.json({
      success: true,
      filePath: hosted ? `${directoryPath}/generations/${filename}` : filePath,
      filename,
      imageId: filename.replace(`.${extension}`, ''),
      isDuplicate: false,
    });
  } catch (error) {
    const storageError = toHostedStorageError(error);
    logger.error('file.error', 'Failed to save generation', { directoryPath: logDirectoryPath }, hosted ? undefined : error instanceof Error ? error : undefined);
    return NextResponse.json(
      {
        success: false,
        error: hosted ? storageError.message : error instanceof Error ? error.message : "Save failed",
      },
      { status: hosted ? storageError.status : 500 }
    );
  }
}
