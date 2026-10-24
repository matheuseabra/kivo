// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  createManagedProject,
  getManagedProjectDirectory,
  isHostedStorageConfigured,
  readJsonRequest,
  resolveManagedProjectPath,
  validateProjectId,
} from "@/lib/hostedStorage";

const originalHosted = process.env.KIVO_HOSTED;
const originalDataDir = process.env.KIVO_DATA_DIR;
let temporaryRoot = "";

async function useTemporaryStorage() {
  temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kivo-storage-test-"));
  process.env.KIVO_HOSTED = "true";
  process.env.KIVO_DATA_DIR = temporaryRoot;
}

afterEach(async () => {
  if (temporaryRoot) await fs.rm(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = "";
  if (originalHosted === undefined) delete process.env.KIVO_HOSTED;
  else process.env.KIVO_HOSTED = originalHosted;
  if (originalDataDir === undefined) delete process.env.KIVO_DATA_DIR;
  else process.env.KIVO_DATA_DIR = originalDataDir;
});

describe("hosted storage paths", () => {
  it("accepts only opaque project IDs, not traversal or absolute paths", () => {
    expect(validateProjectId("a13f7c00-55e1-498d-b6b8-516ab4a47a2e")).toBe(true);
    expect(validateProjectId("../etc")).toBe(false);
    expect(validateProjectId("/tmp/project")).toBe(false);
    expect(validateProjectId("relative/path")).toBe(false);
  });

  it("maps a project ID under the configured data root", async () => {
    await useTemporaryStorage();
    const project = await createManagedProject("Hosted project");
    const projectDirectory = await getManagedProjectDirectory(project.id);
    const realRoot = await fs.realpath(temporaryRoot);
    expect(projectDirectory).toBe(path.join(realRoot, "projects", project.id));
    expect(await resolveManagedProjectPath(project.id, "workflow.json")).toBe(
      path.join(projectDirectory, "workflow.json")
    );
  });

  it("rejects a project directory symlink that escapes the managed root", async () => {
    await useTemporaryStorage();
    const project = await createManagedProject("Hosted project");
    const projectDirectory = await getManagedProjectDirectory(project.id);
    const externalDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "kivo-outside-"));
    await fs.rm(projectDirectory, { recursive: true });
    await fs.symlink(externalDirectory, projectDirectory, "dir");
    await expect(getManagedProjectDirectory(project.id)).rejects.toThrow("cannot be a symlink");
    await fs.rm(externalDirectory, { recursive: true, force: true });
  });

  it("rejects a project symlink even when it points to another managed project", async () => {
    await useTemporaryStorage();
    const first = await createManagedProject("First");
    const second = await createManagedProject("Second");
    const firstDirectory = await getManagedProjectDirectory(first.id);
    const secondDirectory = await getManagedProjectDirectory(second.id);
    await fs.rm(firstDirectory, { recursive: true });
    await fs.symlink(secondDirectory, firstDirectory, "dir");
    await expect(getManagedProjectDirectory(first.id)).rejects.toThrow("cannot be a symlink");
  });

  it("rejects directory and file symlinks that escape the project", async () => {
    await useTemporaryStorage();
    const project = await createManagedProject("Hosted project");
    const projectDirectory = await getManagedProjectDirectory(project.id);
    const outside = path.join(temporaryRoot, "outside.png");
    await fs.writeFile(outside, "secret");
    await fs.symlink(outside, path.join(projectDirectory, "linked.png"));
    await expect(resolveManagedProjectPath(project.id, "linked.png")).rejects.toThrow("Symlink points outside");

    const externalDirectory = path.join(temporaryRoot, "outside-directory");
    await fs.mkdir(externalDirectory);
    await fs.symlink(externalDirectory, path.join(projectDirectory, "inputs"), "dir");
    await expect(resolveManagedProjectPath(project.id, "inputs", "new.png")).rejects.toThrow("Symlink points outside");
  });

  it("requires an absolute dedicated data root", () => {
    process.env.KIVO_DATA_DIR = "relative/path";
    expect(isHostedStorageConfigured()).toBe(false);
    process.env.KIVO_DATA_DIR = path.parse(process.cwd()).root;
    expect(isHostedStorageConfigured()).toBe(false);
  });

  it("bounds streamed JSON request bodies", async () => {
    const request = new Request("http://localhost/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "A project name that exceeds this test limit" }),
    });
    await expect(readJsonRequest(request, 8)).rejects.toThrow("Request body is too large");
  });
});
