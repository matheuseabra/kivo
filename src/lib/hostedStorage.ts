import { randomUUID } from "crypto";
import type { Dirent } from "node:fs";
import * as fs from "fs/promises";
import * as path from "path";

const PROJECTS_FOLDER = "projects";
const PROJECT_METADATA = ".project.json";
const PROJECT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const MAX_MANAGED_PROJECTS = 500;
export const MAX_WORKFLOW_REQUEST_BYTES = 25 * 1024 * 1024;
export const MAX_IMAGE_REQUEST_BYTES = 35 * 1024 * 1024;
export const MAX_GENERATION_REQUEST_BYTES = 136 * 1024 * 1024;
export const MAX_IMAGE_FILE_BYTES = 24 * 1024 * 1024;
export const MAX_GENERATION_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_PROJECT_DIRECTORY_ENTRIES = 1000;

export class HostedStorageError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "HostedStorageError";
  }
}

export interface ManagedProject {
  id: string;
  name: string;
  updatedAt: number;
}

export function isHostedStorageMode(): boolean {
  return process.env.KIVO_HOSTED === "true";
}

export function isHostedStorageConfigured(): boolean {
  const root = process.env.KIVO_DATA_DIR;
  return typeof root === "string" && path.isAbsolute(root) && path.resolve(root) !== path.parse(root).root;
}

export function validateProjectId(projectId: unknown): projectId is string {
  return typeof projectId === "string" && PROJECT_ID_PATTERN.test(projectId);
}

export function safeHostedWorkflowFilename(filename: unknown): string | null {
  if (typeof filename !== "string" || !filename.trim() || filename.length > 100 || filename.includes("..") || /[\\/\u0000-\u001f]/.test(filename)) {
    return null;
  }
  return filename.trim().replace(/[^\p{L}\p{N}_-]/gu, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 100) || "workflow";
}

export async function readJsonRequest<T>(request: Request, maxBytes: number): Promise<T> {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > maxBytes) throw new HostedStorageError("Request body is too large", 413);
  if (!request.body) throw new HostedStorageError("Request body is required");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new HostedStorageError("Request body is too large", 413);
    }
    chunks.push(value);
  }
  try {
    const json = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf-8");
    return JSON.parse(json) as T;
  } catch {
    throw new HostedStorageError("Invalid JSON request body");
  }
}

function configuredRoot(): string {
  const root = process.env.KIVO_DATA_DIR;
  if (!root || !path.isAbsolute(root) || path.resolve(root) === path.parse(root).root) {
    throw new HostedStorageError("Hosted storage requires an absolute KIVO_DATA_DIR", 503);
  }
  return path.resolve(root);
}

function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function getDataRoot(): Promise<string> {
  const root = configuredRoot();
  await fs.mkdir(root, { recursive: true });
  return fs.realpath(root);
}

async function getProjectsRoot(): Promise<string> {
  const root = await getDataRoot();
  const projectsPath = path.join(root, PROJECTS_FOLDER);
  await fs.mkdir(projectsPath, { recursive: true });
  if ((await fs.lstat(projectsPath)).isSymbolicLink()) {
    throw new HostedStorageError("Hosted projects directory cannot be a symlink", 403);
  }
  const realProjectsPath = await fs.realpath(projectsPath);
  if (!isWithin(root, realProjectsPath) || realProjectsPath === root) {
    throw new HostedStorageError("Hosted projects directory is outside KIVO_DATA_DIR", 403);
  }
  return realProjectsPath;
}

async function realpathForContainedPath(basePath: string, targetPath: string): Promise<string> {
  const realBase = await fs.realpath(basePath);
  const absoluteTarget = path.resolve(targetPath);
  if (!isWithin(realBase, absoluteTarget)) {
    throw new HostedStorageError("Path is outside the managed project", 403);
  }

  let cursor = absoluteTarget;
  const missingSegments: string[] = [];
  while (true) {
    try {
      const stats = await fs.lstat(cursor);
      if (stats.isSymbolicLink()) {
        const realTarget = await fs.realpath(cursor);
        if (!isWithin(realBase, realTarget)) {
          throw new HostedStorageError("Symlink points outside the managed project", 403);
        }
        cursor = realTarget;
      } else {
        cursor = await fs.realpath(cursor);
      }
      break;
    } catch (error) {
      if (error instanceof HostedStorageError) throw error;
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw new HostedStorageError("Unable to resolve storage path", 403);
      missingSegments.unshift(path.basename(cursor));
      cursor = parent;
    }
  }

  const resolved = path.join(cursor, ...missingSegments);
  if (!isWithin(realBase, resolved)) {
    throw new HostedStorageError("Path resolves outside the managed project", 403);
  }
  return resolved;
}

export async function getManagedProjectDirectory(projectId: unknown): Promise<string> {
  if (!validateProjectId(projectId)) {
    throw new HostedStorageError("Invalid project ID");
  }
  const projectsRoot = await getProjectsRoot();
  const projectPath = path.join(projectsRoot, projectId);
  const linkStats = await fs.lstat(projectPath).catch(() => null);
  if (linkStats?.isSymbolicLink()) {
    throw new HostedStorageError("Managed project directory cannot be a symlink", 403);
  }
  const realProjectPath = await realpathForContainedPath(projectsRoot, projectPath);
  const stats = await fs.stat(realProjectPath).catch(() => null);
  if (!stats?.isDirectory()) {
    throw new HostedStorageError("Managed project not found", 404);
  }
  return realProjectPath;
}

export async function resolveManagedProjectPath(
  projectId: unknown,
  ...segments: string[]
): Promise<string> {
  const projectPath = await getManagedProjectDirectory(projectId);
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || path.isAbsolute(segment) || segment.includes("/") || segment.includes("\\"))) {
    throw new HostedStorageError("Invalid managed storage path");
  }
  const candidate = path.join(projectPath, ...segments);
  return realpathForContainedPath(projectPath, candidate);
}

export async function readManagedProjectEntries(projectId: unknown): Promise<Dirent[]> {
  const projectPath = await getManagedProjectDirectory(projectId);
  const directory = await fs.opendir(projectPath);
  const entries: Dirent[] = [];
  for await (const entry of directory) {
    entries.push(entry);
    if (entries.length > MAX_PROJECT_DIRECTORY_ENTRIES) {
      throw new HostedStorageError("Managed project contains too many entries", 413);
    }
  }
  return entries;
}

export async function ensureHostedDiskSpace(bytes: number): Promise<void> {
  const root = await getDataRoot();
  const stats = await fs.statfs(root);
  const availableBytes = stats.bavail * stats.bsize;
  if (bytes > availableBytes) {
    throw new HostedStorageError("Not enough free space in hosted storage", 507);
  }
}

export async function createManagedProject(name: unknown): Promise<ManagedProject> {
  if (typeof name !== "string" || !name.trim() || name.trim().length > 80 || /[\\/\u0000-\u001f]/.test(name)) {
    throw new HostedStorageError("Project name must contain 1 to 80 characters");
  }
  const projectsRoot = await getProjectsRoot();
  const projectsDirectory = await fs.opendir(projectsRoot);
  let entryCount = 0;
  for await (const entry of projectsDirectory) {
    entryCount += entry.name ? 1 : 0;
    if (entryCount >= MAX_MANAGED_PROJECTS) {
      throw new HostedStorageError("Managed project limit reached", 413);
    }
  }
  const id = randomUUID();
  const projectPath = path.join(projectsRoot, id);
  await fs.mkdir(projectPath, { recursive: false });
  const metadataPath = await resolveManagedProjectPath(id, PROJECT_METADATA);
  const metadata = { name: name.trim(), createdAt: Date.now() };
  await fs.writeFile(metadataPath, JSON.stringify(metadata), { encoding: "utf-8", flag: "wx" });
  return { id, name: metadata.name, updatedAt: metadata.createdAt };
}

export async function listManagedProjects(): Promise<ManagedProject[]> {
  const projectsRoot = await getProjectsRoot();
  const directory = await fs.opendir(projectsRoot);
  const entries: Dirent[] = [];
  for await (const entry of directory) {
    entries.push(entry);
    if (entries.length > MAX_MANAGED_PROJECTS) {
      throw new HostedStorageError("Too many managed projects to list", 413);
    }
  }
  const projects = await Promise.all(entries.map(async (entry): Promise<ManagedProject | null> => {
    if (!entry.isDirectory() || !validateProjectId(entry.name)) return null;
    try {
      const directory = await getManagedProjectDirectory(entry.name);
      const metadataPath = await resolveManagedProjectPath(entry.name, PROJECT_METADATA);
      const metadataStat = await fs.stat(metadataPath);
      if (metadataStat.size > 4096) return null;
      const metadata = JSON.parse(await fs.readFile(metadataPath, "utf-8")) as { name?: unknown; createdAt?: unknown };
      if (typeof metadata.name !== "string" || !metadata.name.trim() || metadata.name.length > 80 || /[\\/\u0000-\u001f]/.test(metadata.name)) return null;
      const stats = await fs.stat(directory);
      return {
        id: entry.name,
        name: metadata.name.trim(),
        updatedAt: typeof metadata.createdAt === "number" ? metadata.createdAt : stats.mtimeMs,
      };
    } catch {
      return null;
    }
  }));
  return projects.filter((project): project is ManagedProject => project !== null);
}

export function toHostedStorageError(error: unknown): HostedStorageError {
  return error instanceof HostedStorageError
    ? error
    : new HostedStorageError("Hosted storage operation failed", 500);
}
