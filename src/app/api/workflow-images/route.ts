import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs/promises";
import * as path from "path";
import { logger } from "@/utils/logger";
import { validateWorkflowPath } from "@/utils/pathValidation";
import { isVercelEnvironment, unsupportedOnVercelResponse } from "@/utils/vercelEnvironment";
import {
  ensureHostedDiskSpace,
  getManagedProjectDirectory,
  isHostedStorageMode,
  MAX_IMAGE_FILE_BYTES,
  MAX_IMAGE_REQUEST_BYTES,
  readJsonRequest,
  resolveManagedProjectPath,
  toHostedStorageError,
  validateProjectId,
} from "@/lib/hostedStorage";

export const maxDuration = 300; // 5 minute timeout for large image operations

const IMAGES_FOLDER = "inputs";
const LEGACY_IMAGES_FOLDER = ".images"; // For backward compatibility

// Helper to extract MIME type and extension from data URL
function getMimeAndExtension(dataUrl: string): { mime: string; extension: string } {
  const match = dataUrl.match(/^data:(image\/\w+);base64,/);
  if (match) {
    const mime = match[1];
    const mimeToExt: Record<string, string> = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/jpg": "jpg",
      "image/gif": "gif",
      "image/webp": "webp",
    };
    return { mime, extension: mimeToExt[mime] || "png" };
  }
  // Default to PNG if no MIME type found
  return { mime: "image/png", extension: "png" };
}

// POST: Save an image to the workflow's inputs or generations folder
export async function POST(request: NextRequest) {
  if (isVercelEnvironment()) {
    return unsupportedOnVercelResponse("Saving workflow images to the local filesystem");
  }

  let workflowPath: string | undefined;
  let imageId: string | undefined;
  let folder: string | undefined;
  let logWorkflowPath: string | undefined;
  let logImageId: string | undefined;
  const hosted = isHostedStorageMode();
  try {
    const body = hosted
      ? await readJsonRequest<Record<string, any>>(request, MAX_IMAGE_REQUEST_BYTES)
      : await request.json();
    workflowPath = body.workflowPath;
    imageId = body.imageId;
    const requestedFolder = body.folder;
    folder = body.folder || IMAGES_FOLDER; // Default to "inputs"
    const imageData = body.imageData; // Base64 data URL
    logWorkflowPath = hosted && !validateProjectId(workflowPath) ? undefined : workflowPath;
    logImageId = hosted && (typeof imageId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$/.test(imageId)) ? undefined : imageId;

    if (hosted && requestedFolder !== undefined && requestedFolder !== IMAGES_FOLDER && requestedFolder !== "generations") {
      return NextResponse.json({ success: false, error: "Invalid image folder" }, { status: 400 });
    }
    // Validate folder is one of the allowed values
    if (folder !== IMAGES_FOLDER && folder !== "generations") {
      folder = IMAGES_FOLDER;
    }

    logger.info('file.save', 'Workflow image save request received', {
      workflowPath: logWorkflowPath,
      imageId: logImageId,
      folder,
      hasImageData: !!imageData,
    });

    if (typeof workflowPath !== "string" || typeof imageId !== "string" || typeof imageData !== "string") {
      logger.warn('file.save', 'Workflow image save validation failed: missing fields', {
        hasWorkflowPath: !!workflowPath,
        hasImageId: !!imageId,
        hasImageData: !!imageData,
      });
      return NextResponse.json(
        { success: false, error: "Missing required fields (workflowPath, imageId, imageData)" },
        { status: 400 }
      );
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$/.test(imageId)) {
      return NextResponse.json({ success: false, error: "Invalid imageId" }, { status: 400 });
    }
    const safeImageId = imageId;

    let projectDirectory: string;
    if (hosted) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(workflowPath)) {
        return NextResponse.json({ success: false, error: "Invalid project ID" }, { status: 400 });
      }
      projectDirectory = await getManagedProjectDirectory(workflowPath);
    } else {
      const pathValidation = validateWorkflowPath(workflowPath);
      if (!pathValidation.valid) {
        return NextResponse.json({ success: false, error: pathValidation.error }, { status: 400 });
      }
      projectDirectory = workflowPath;
    }

    // Validate workflow directory exists, or create it if missing
    try {
      const stats = await fs.stat(projectDirectory);
      if (!stats.isDirectory()) {
        logger.warn('file.error', 'Workflow image save failed: path is not a directory', {
          workflowPath: logWorkflowPath,
        });
        return NextResponse.json(
          { success: false, error: "Workflow path is not a directory" },
          { status: 400 }
        );
      }
    } catch (dirError) {
      const err = dirError as NodeJS.ErrnoException;
      const isNotFound =
        err?.code === "ENOENT" ||
        (typeof err?.message === "string" &&
          (err.message.includes("ENOENT") || err.message.includes("no such file or directory")));

      if (!isNotFound) {
        logger.warn('file.error', 'Workflow image save failed: directory validation error', {
          workflowPath: logWorkflowPath,
          error: dirError instanceof Error ? dirError.message : 'Unknown error',
        });
        return NextResponse.json(
          { success: false, error: "Directory validation failed" },
          { status: 400 }
        );
      }

      try {
        if (hosted) throw dirError;
        await fs.mkdir(projectDirectory, { recursive: true });
        logger.info('file.save', 'Created workflow directory for image save', {
          workflowPath: logWorkflowPath,
        });
      } catch (mkdirError) {
        logger.error('file.error', 'Failed to create workflow directory', {
          workflowPath: logWorkflowPath,
        }, mkdirError instanceof Error ? mkdirError : undefined);
        return NextResponse.json(
          { success: false, error: "Failed to create workflow directory" },
          { status: 500 }
        );
      }
    }

    // Create target folder if it doesn't exist
    const targetFolder = hosted
      ? await resolveManagedProjectPath(workflowPath, folder)
      : path.join(projectDirectory, folder);
    try {
      await fs.mkdir(targetFolder, { recursive: true });
      if (hosted) await resolveManagedProjectPath(workflowPath, folder);
    } catch (mkdirError) {
      logger.error('file.error', 'Failed to create target folder', {
        targetFolder: hosted ? `${workflowPath}/${folder}` : targetFolder,
      }, hosted ? undefined : mkdirError instanceof Error ? mkdirError : undefined);
      return NextResponse.json(
        { success: false, error: "Failed to create target folder" },
        { status: 500 }
      );
    }

    // Extract MIME type and determine file extension
    if (hosted && !/^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(imageData)) {
      return NextResponse.json({ success: false, error: "Unsupported image data" }, { status: 400 });
    }
    const { extension } = getMimeAndExtension(imageData);
    const filename = `${safeImageId}.${extension}`;

    // Extract base64 data and convert to buffer
    const base64Data = imageData.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");
    if (hosted && (buffer.length > MAX_IMAGE_FILE_BYTES || buffer.length === 0)) {
      return NextResponse.json({ success: false, error: "Image file must be between 1 byte and 24 MiB" }, { status: 413 });
    }
    if (hosted) await ensureHostedDiskSpace(buffer.length);
    const filePath = hosted
      ? await resolveManagedProjectPath(workflowPath, folder, filename)
      : path.join(targetFolder, filename);

    // Write the image file
    await fs.writeFile(filePath, buffer);

    logger.info('file.save', 'Workflow image saved successfully', {
      filePath: hosted ? `${workflowPath}/${folder}/${filename}` : filePath,
      imageId,
      fileSize: buffer.length,
    });

    return NextResponse.json({
      success: true,
      imageId,
      filePath: hosted ? `${workflowPath}/${folder}/${filename}` : filePath,
    });
  } catch (error) {
    const storageError = toHostedStorageError(error);
    logger.error('file.error', 'Failed to save workflow image', {
      workflowPath: logWorkflowPath,
      imageId: logImageId,
    }, hosted ? undefined : error instanceof Error ? error : undefined);
    return NextResponse.json(
      {
        success: false,
        error: hosted ? storageError.message : error instanceof Error ? error.message : "Save failed",
      },
      { status: hosted ? storageError.status : 500 }
    );
  }
}

// GET: Load an image from the workflow's folders (inputs, generations, or legacy .images)
export async function GET(request: NextRequest) {
  if (isVercelEnvironment()) {
    return unsupportedOnVercelResponse("Loading workflow images from the local filesystem");
  }

  const workflowPath = request.nextUrl.searchParams.get("workflowPath");
  const imageId = request.nextUrl.searchParams.get("imageId");
  const folder = request.nextUrl.searchParams.get("folder"); // Optional hint for which folder to check first
  const hosted = isHostedStorageMode();
  const logWorkflowPath = hosted && !validateProjectId(workflowPath) ? undefined : workflowPath;
  const logImageId = hosted && (!imageId || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$/.test(imageId)) ? undefined : imageId;

  logger.info('file.load', 'Workflow image load request received', {
    workflowPath: logWorkflowPath,
    imageId: logImageId,
    folder: hosted && folder !== IMAGES_FOLDER && folder !== "generations" ? undefined : folder,
  });

  if (!workflowPath || !imageId) {
    logger.warn('file.load', 'Workflow image load validation failed: missing parameters', {
      hasWorkflowPath: !!workflowPath,
      hasImageId: !!imageId,
    });
    return NextResponse.json(
      { success: false, error: "Missing required parameters (workflowPath, imageId)" },
      { status: 400 }
    );
  }

  try {
    const projectDirectory = hosted
      ? await getManagedProjectDirectory(workflowPath)
      : workflowPath;
    if (!hosted) {
      const pathValidation = validateWorkflowPath(workflowPath);
      if (!pathValidation.valid) {
        return NextResponse.json({ success: false, error: pathValidation.error }, { status: 400 });
      }
    }

    if (hosted && folder && folder !== IMAGES_FOLDER && folder !== "generations") {
      return NextResponse.json({ success: false, error: "Invalid image folder" }, { status: 400 });
    }

    // Sanitize imageId to prevent path traversal
    const validImageId = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$/.test(imageId);
    if (!validImageId) {
      return NextResponse.json(
        { success: false, error: "Invalid imageId" },
        { status: 400 }
      );
    }
    const safeImageId = imageId;

    // Validate workflow directory exists
    try {
      const stats = await fs.stat(projectDirectory);
      if (!stats.isDirectory()) {
        return NextResponse.json(
          { success: false, error: "Workflow path is not a directory" },
          { status: 400 }
        );
      }
    } catch {
      return NextResponse.json(
        { success: false, error: "Workflow directory does not exist" },
        { status: 400 }
      );
    }

    // Construct file path - check folders and extensions in order
    const possibleExtensions = ["png", "jpg", "jpeg", "gif", "webp"];
    const inputsFolder = path.join(projectDirectory, IMAGES_FOLDER);
    const generationsFolder = path.join(projectDirectory, "generations");
    const legacyFolder = path.join(projectDirectory, LEGACY_IMAGES_FOLDER);

    // Build search order based on folder hint
    const searchOrder = folder === "generations"
      ? [generationsFolder, inputsFolder, legacyFolder]
      : [inputsFolder, generationsFolder, legacyFolder];

    let filePath: string | null = null;
    let foundExtension = "png"; // Track which extension was found

    // Check each folder and extension combination in order
    for (const searchFolder of searchOrder) {
      for (const ext of possibleExtensions) {
        const filename = `${safeImageId}.${ext}`;
        try {
          const candidatePath = hosted
            ? await resolveManagedProjectPath(workflowPath, path.basename(searchFolder), filename)
            : path.join(searchFolder, filename);
          await fs.access(candidatePath);
          filePath = candidatePath;
          foundExtension = ext;
          if (searchFolder === legacyFolder) {
            logger.info('file.load', 'Found image in legacy .images folder', {
              filePath: hosted ? `${workflowPath}/.images/${filename}` : filePath,
            });
          }
          break;
        } catch {
          // File not found with this extension, try next
        }
      }
      if (filePath) break; // Stop searching if file was found
    }

    if (!filePath) {
      // Return 200 with success: false to avoid Next.js error overlay
      // Missing files are expected when workflow refs point to deleted/moved images
      logger.info('file.load', 'Workflow image not found (expected for missing refs)', {
        imageId: logImageId,
        searchedFolders: hosted ? [IMAGES_FOLDER, "generations", LEGACY_IMAGES_FOLDER] : searchOrder,
      });
      return NextResponse.json({
        success: false,
        error: "Image file not found",
        notFound: true,
      });
    }

    const imageStats = await fs.stat(filePath);
    if (hosted && imageStats.size > MAX_IMAGE_FILE_BYTES) {
      return NextResponse.json({ success: false, error: "Image file is too large" }, { status: 413 });
    }

    // Read the image file
    const buffer = await fs.readFile(filePath);

    // Convert to base64 data URL with correct MIME type
    const base64 = buffer.toString("base64");
    const mimeType = foundExtension === "jpg" || foundExtension === "jpeg"
      ? "image/jpeg"
      : `image/${foundExtension}`;
    const dataUrl = `data:${mimeType};base64,${base64}`;

    logger.info('file.load', 'Workflow image loaded successfully', {
      filePath: hosted ? `${workflowPath}/${path.basename(path.dirname(filePath))}/${path.basename(filePath)}` : filePath,
      imageId: logImageId,
      fileSize: buffer.length,
    });

    return NextResponse.json({
      success: true,
      imageId,
      image: dataUrl,
    });
  } catch (error) {
    const storageError = toHostedStorageError(error);
    logger.error('file.error', 'Failed to load workflow image', {
      workflowPath: logWorkflowPath,
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
