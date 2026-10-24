import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs/promises";
import * as path from "path";
import { logger } from "@/utils/logger";
import { validateWorkflowPath } from "@/utils/pathValidation";
import { isVercelEnvironment, unsupportedOnVercelResponse } from "@/utils/vercelEnvironment";
import {
  getManagedProjectDirectory,
  ensureHostedDiskSpace,
  isHostedStorageMode,
  MAX_WORKFLOW_REQUEST_BYTES,
  readManagedProjectEntries,
  safeHostedWorkflowFilename,
  readJsonRequest,
  resolveManagedProjectPath,
  toHostedStorageError,
  validateProjectId,
} from "@/lib/hostedStorage";

export const maxDuration = 300; // 5 minute timeout for large workflow files

// POST: Save workflow to file
export async function POST(request: NextRequest) {
  if (isVercelEnvironment()) {
    return unsupportedOnVercelResponse("Saving workflows to the local filesystem");
  }

  let directoryPath: string | undefined;
  let filename: string | undefined;
  let logDirectoryPath: string | undefined;
  let logFilename: string | undefined;
  const hosted = isHostedStorageMode();
  try {
    const body = hosted
      ? await readJsonRequest<Record<string, any>>(request, MAX_WORKFLOW_REQUEST_BYTES)
      : await request.json();
    directoryPath = body.directoryPath;
    filename = body.filename;
    const workflow = body.workflow;
    logDirectoryPath = hosted && !validateProjectId(directoryPath) ? undefined : directoryPath;
    logFilename = hosted ? safeHostedWorkflowFilename(filename) || undefined : filename;

    logger.info('file.save', 'Workflow save request received', {
      directoryPath: logDirectoryPath,
      filename: logFilename,
      hasWorkflow: !!workflow,
      nodeCount: workflow?.nodes?.length,
      edgeCount: workflow?.edges?.length,
    });

    if (typeof directoryPath !== "string" || typeof filename !== "string" || !workflow) {
      logger.warn('file.save', 'Workflow save validation failed: missing fields', {
        hasDirectoryPath: !!directoryPath,
        hasFilename: !!filename,
        hasWorkflow: !!workflow,
      });
      return NextResponse.json(
        { success: false, error: "Missing required fields" },
        { status: 400 }
      );
    }

    let projectDirectory: string;
    if (hosted) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(directoryPath)) {
        return NextResponse.json({ success: false, error: "Invalid project ID" }, { status: 400 });
      }
      projectDirectory = await getManagedProjectDirectory(directoryPath);
    } else {
      const pathValidation = validateWorkflowPath(directoryPath);
      if (!pathValidation.valid) {
        return NextResponse.json({ success: false, error: pathValidation.error }, { status: 400 });
      }
      projectDirectory = directoryPath;
    }

    // Ensure project directory exists (supports saving into new subfolders)
    try {
      const stats = await fs.stat(projectDirectory);
      if (!stats.isDirectory()) {
        logger.warn('file.error', 'Workflow save failed: path is not a directory', {
          directoryPath: logDirectoryPath,
        });
        return NextResponse.json(
          { success: false, error: "Path is not a directory" },
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
        logger.warn('file.error', 'Workflow save failed: directory validation error', {
          directoryPath: logDirectoryPath,
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
      } catch (mkdirError) {
        logger.warn('file.error', 'Workflow save failed: could not create directory', {
          directoryPath: logDirectoryPath,
          error: mkdirError instanceof Error ? mkdirError.message : 'Unknown error',
        });
        return NextResponse.json(
          { success: false, error: "Could not create directory" },
          { status: 500 }
        );
      }
    }

    // Auto-create subfolders for inputs and generations
    const inputsFolder = hosted
      ? await resolveManagedProjectPath(directoryPath, "inputs")
      : path.join(projectDirectory, "inputs");
    const generationsFolder = hosted
      ? await resolveManagedProjectPath(directoryPath, "generations")
      : path.join(projectDirectory, "generations");

    try {
      await fs.mkdir(inputsFolder, { recursive: true });
      await fs.mkdir(generationsFolder, { recursive: true });
      if (hosted) {
        await resolveManagedProjectPath(directoryPath, "inputs");
        await resolveManagedProjectPath(directoryPath, "generations");
      }
    } catch (mkdirError) {
      if (hosted) throw mkdirError;
      logger.warn('file.save', 'Failed to create subfolders (non-fatal)', {
        inputsFolder,
        generationsFolder,
        error: mkdirError instanceof Error ? mkdirError.message : 'Unknown error',
      });
      // Continue anyway - folders may already exist or be created later
    }

    // Sanitize filename (remove special chars, ensure .json extension)
    const hostedSafeName = hosted ? safeHostedWorkflowFilename(filename) : null;
    if (hosted && !hostedSafeName) {
      return NextResponse.json({ success: false, error: "Invalid filename" }, { status: 400 });
    }
    const safeName = hosted ? hostedSafeName! : filename.replace(/[^a-zA-Z0-9-_]/g, "_");
    const filePath = hosted
      ? await resolveManagedProjectPath(directoryPath, `${safeName}.json`)
      : path.join(projectDirectory, `${safeName}.json`);

    // Write workflow JSON
    const workflowToSave = hosted ? { ...workflow, directoryPath } : workflow;
    const json = JSON.stringify(workflowToSave, null, 2);
    if (hosted && Buffer.byteLength(json, "utf-8") > MAX_WORKFLOW_REQUEST_BYTES) {
      return NextResponse.json({ success: false, error: "Workflow file is too large" }, { status: 413 });
    }
    if (hosted) await ensureHostedDiskSpace(Buffer.byteLength(json, "utf-8"));
    await fs.writeFile(filePath, json, "utf-8");

    logger.info('file.save', 'Workflow saved successfully', {
      filePath: hosted ? `${directoryPath}/${safeName}.json` : filePath,
      fileSize: json.length,
    });

    return NextResponse.json({
      success: true,
      filePath: hosted ? `${directoryPath}/${safeName}.json` : filePath,
    });
  } catch (error) {
    const storageError = toHostedStorageError(error);
    logger.error('file.error', 'Failed to save workflow', {
      directoryPath: logDirectoryPath,
      filename: logFilename,
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

// GET: Validate directory path, or load workflow from directory
export async function GET(request: NextRequest) {
  if (isVercelEnvironment()) {
    return unsupportedOnVercelResponse("Loading workflows from the local filesystem");
  }

  const directoryPath = request.nextUrl.searchParams.get("path");
  const shouldLoad = request.nextUrl.searchParams.get("load") === "true";
  const hosted = isHostedStorageMode();
  const logDirectoryPath = hosted && !validateProjectId(directoryPath) ? undefined : directoryPath;

  logger.info('file.load', 'Directory request received', {
    directoryPath: logDirectoryPath,
    shouldLoad,
  });

  if (!directoryPath) {
    logger.warn('file.load', 'Directory validation failed: missing path parameter');
    return NextResponse.json(
      { success: false, error: "Path parameter required" },
      { status: 400 }
    );
  }

  try {
    let projectDirectory: string;
    if (hosted) {
      projectDirectory = await getManagedProjectDirectory(directoryPath);
    } else {
      const pathValidation = validateWorkflowPath(directoryPath);
      if (!pathValidation.valid) {
        return NextResponse.json({ success: false, error: pathValidation.error }, { status: 400 });
      }
      projectDirectory = directoryPath;
    }
    const stats = await fs.stat(projectDirectory);
    const isDirectory = stats.isDirectory();

    if (!isDirectory) {
      return NextResponse.json({
        success: true,
        exists: true,
        isDirectory: false,
      });
    }

    // If load=true, find and return a workflow JSON from the directory
    if (shouldLoad) {
      const jsonFiles = hosted
        ? (await readManagedProjectEntries(directoryPath))
            .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
            .map((entry) => entry.name)
        : (await fs.readdir(projectDirectory)).filter((entry) => entry.endsWith(".json"));

      // Gather candidates with mtime for deterministic selection (newest first)
      const candidates: { jsonFile: string; filePath: string; mtime: number }[] = [];
      for (const jsonFile of jsonFiles) {
        try {
          const filePath = hosted
            ? await resolveManagedProjectPath(directoryPath, jsonFile)
            : path.join(projectDirectory, jsonFile);
          const stat = await fs.stat(filePath);
          if (hosted && stat.size > MAX_WORKFLOW_REQUEST_BYTES) {
            return NextResponse.json({ success: false, error: "Workflow file is too large" }, { status: 413 });
          }
          candidates.push({ jsonFile, filePath, mtime: stat.mtimeMs });
        } catch {
          continue;
        }
      }
      candidates.sort((a, b) => b.mtime - a.mtime);

      for (const { jsonFile, filePath } of candidates) {
        try {
          const content = await fs.readFile(filePath, "utf-8");
          const parsed = JSON.parse(content);

          if (
            typeof parsed.version === "number" &&
            Array.isArray(parsed.nodes) &&
            Array.isArray(parsed.edges)
          ) {
            const filename = path.basename(jsonFile, ".json");
            if (hosted) parsed.directoryPath = directoryPath;
            logger.info('file.load', 'Workflow loaded from directory', {
              directoryPath: logDirectoryPath,
              filename: jsonFile,
            });
            return NextResponse.json({
              success: true,
              workflow: parsed,
              filename,
            });
          }
        } catch {
          // Skip files that can't be read or parsed
          continue;
        }
      }

      logger.warn('file.load', 'No valid workflow file found in directory', {
        directoryPath: logDirectoryPath,
        jsonFilesChecked: jsonFiles.length,
      });
      return NextResponse.json(
        { success: false, error: "No workflow file found in directory" },
        { status: 404 }
      );
    }

    logger.info('file.load', 'Directory validation successful', {
      directoryPath: logDirectoryPath,
      exists: true,
      isDirectory,
    });
    return NextResponse.json({
      success: true,
      exists: true,
      isDirectory,
    });
  } catch (error) {
    const storageError = toHostedStorageError(error);
    logger.info('file.load', 'Directory does not exist', {
      directoryPath: logDirectoryPath,
    });
    if (hosted) {
      return NextResponse.json({ success: false, error: storageError.message }, { status: storageError.status });
    }
    return NextResponse.json({
      success: true,
      exists: false,
      isDirectory: false,
    });
  }
}
