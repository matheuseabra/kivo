import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs/promises";
import * as path from "path";
import { logger } from "@/utils/logger";
import { isVercelEnvironment, unsupportedOnVercelResponse } from "@/utils/vercelEnvironment";
import {
  getManagedProjectDirectory,
  isHostedStorageMode,
  MAX_GENERATION_FILE_BYTES,
  readJsonRequest,
  resolveManagedProjectPath,
  toHostedStorageError,
  validateProjectId,
} from "@/lib/hostedStorage";
import { validateWorkflowPath } from "@/utils/pathValidation";

// Supported file extensions
const SUPPORTED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'webm', 'mov', 'mp3', 'wav', 'ogg', 'flac', 'aac'];

// Video extensions
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov'];

// Audio extensions
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'flac', 'aac'];

// Extension to MIME type mapping
const EXT_TO_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  aac: 'audio/aac',
};

// POST: Load a generated image or video from the generations folder by ID
export async function POST(request: NextRequest) {
  if (isVercelEnvironment()) {
    return unsupportedOnVercelResponse("Loading saved local generations");
  }

  let directoryPath: string | undefined;
  let imageId: string | undefined;
  let logDirectoryPath: string | undefined;
  let logImageId: string | undefined;
  const hosted = isHostedStorageMode();
  try {
    const body = hosted
      ? await readJsonRequest<Record<string, any>>(request, 4096)
      : await request.json();
    directoryPath = body.directoryPath;
    imageId = body.imageId;
    const folder = body.folder;
    logDirectoryPath = hosted && !validateProjectId(directoryPath) ? undefined : directoryPath;
    logImageId = hosted && (typeof imageId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$/.test(imageId)) ? undefined : imageId;

    logger.info('file.load', 'Generation load request received', {
      directoryPath: logDirectoryPath,
      imageId: logImageId,
    });

    if (typeof directoryPath !== "string" || typeof imageId !== "string") {
      logger.warn('file.load', 'Generation load validation failed: missing fields', {
        hasDirectoryPath: !!directoryPath,
        hasImageId: !!imageId,
      });
      return NextResponse.json(
        { success: false, error: "Missing required fields" },
        { status: 400 }
      );
    }

    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$/.test(imageId)) {
      return NextResponse.json({ success: false, error: "Invalid image ID" }, { status: 400 });
    }
    if (hosted && (!validateProjectId(directoryPath) || (folder !== undefined && folder !== "generations"))) {
      return NextResponse.json({ success: false, error: "Invalid project ID or folder" }, { status: 400 });
    }

    let generationDirectory: string;
    if (hosted) {
      await getManagedProjectDirectory(directoryPath);
      generationDirectory = await resolveManagedProjectPath(directoryPath, "generations");
    } else {
      const pathValidation = validateWorkflowPath(directoryPath);
      if (!pathValidation.valid) {
        return NextResponse.json({ success: false, error: pathValidation.error }, { status: 400 });
      }
      generationDirectory = folder === "generations"
        ? path.join(directoryPath, "generations")
        : directoryPath;
    }

    // Validate directory exists
    try {
      const stats = await fs.stat(generationDirectory);
      if (!stats.isDirectory()) {
        logger.warn('file.error', 'Generation load failed: path is not a directory', {
          directoryPath: logDirectoryPath,
        });
        return NextResponse.json(
          { success: false, error: "Path is not a directory" },
          { status: 400 }
        );
      }
    } catch (dirError) {
      logger.warn('file.error', 'Generation load failed: directory does not exist', {
        directoryPath: logDirectoryPath,
      });
      return NextResponse.json(
        { success: false, error: "Directory does not exist" },
        { status: 400 }
      );
    }

    // Find the file by ID with any supported extension
    let foundExtension: string | null = null;
    let filePath: string | null = null;

    for (const ext of SUPPORTED_EXTENSIONS) {
      const candidatePath = hosted
        ? await resolveManagedProjectPath(directoryPath, "generations", `${imageId}.${ext}`)
        : path.join(generationDirectory, `${imageId}.${ext}`);
      try {
        await fs.access(candidatePath);
        foundExtension = ext;
        filePath = candidatePath;
        break;
      } catch {
        // File doesn't exist with this extension, continue
      }
    }

    if (!foundExtension || !filePath) {
      // Return 200 with success: false to avoid Next.js error overlay
      // Missing files are expected when workflow refs point to deleted/moved images
      logger.info('file.load', 'Generation file not found (expected for missing refs)', {
        imageId: logImageId,
        directoryPath: logDirectoryPath,
      });
      return NextResponse.json({
        success: false,
        error: "File not found",
        notFound: true,
      });
    }

    // Read the file
    const fileStats = await fs.stat(filePath);
    if (hosted && fileStats.size > MAX_GENERATION_FILE_BYTES) {
      return NextResponse.json({ success: false, error: "Generation file is too large" }, { status: 413 });
    }
    const buffer = await fs.readFile(filePath);

    // Convert to base64 data URL
    const mimeType = EXT_TO_MIME[foundExtension] || 'application/octet-stream';
    const base64 = buffer.toString("base64");
    const dataUrl = `data:${mimeType};base64,${base64}`;

    // Determine content type
    const isVideo = VIDEO_EXTENSIONS.includes(foundExtension);
    const isAudio = AUDIO_EXTENSIONS.includes(foundExtension);
    const contentType = isVideo ? 'video' : isAudio ? 'audio' : 'image';

    logger.info('file.load', 'Generation loaded successfully', {
      filePath: hosted ? `${directoryPath}/generations/${imageId}.${foundExtension}` : filePath,
      extension: foundExtension,
      contentType,
      fileSize: buffer.length,
    });

    // Return appropriate response field based on content type
    const response: Record<string, unknown> = {
      success: true,
      contentType,
    };

    if (isVideo) {
      response.video = dataUrl;
    } else if (isAudio) {
      response.audio = dataUrl;
    } else {
      response.image = dataUrl;
    }

    return NextResponse.json(response);
  } catch (error) {
    const storageError = toHostedStorageError(error);
    logger.error('file.error', 'Failed to load generation', {
      directoryPath: logDirectoryPath,
      imageId: logImageId,
    }, hosted ? undefined : error instanceof Error ? error : undefined);
    return NextResponse.json(
      {
        success: false,
        error: hosted ? storageError.message : error instanceof Error ? error.message : "Load failed",
      },
      { status: hosted ? storageError.status : 500 }
    );
  }
}
