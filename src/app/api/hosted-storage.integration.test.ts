// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { GET as getCapabilities } from "@/app/api/capabilities/route";
import { GET as listProjects, POST as createProject } from "@/app/api/projects/route";
import { GET as getWorkflow, POST as saveWorkflow } from "@/app/api/workflow/route";
import { GET as listWorkflows } from "@/app/api/list-workflows/route";
import { GET as getWorkflowImage, POST as saveWorkflowImage } from "@/app/api/workflow-images/route";
import { POST as loadGeneration } from "@/app/api/load-generation/route";
import { POST as saveGeneration } from "@/app/api/save-generation/route";
import { GET as browseDirectory } from "@/app/api/browse-directory/route";
import { POST as openDirectory } from "@/app/api/open-directory/route";
import { POST as openFile } from "@/app/api/open-file/route";

let dataRoot = "";
let oldHosted: string | undefined;
let oldDataDir: string | undefined;
let oldVercel: string | undefined;

function postRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getRequest(url: string): NextRequest {
  return new NextRequest(url);
}

async function createProjectId(name = "My project"): Promise<string> {
  const response = await createProject(postRequest("http://localhost/api/projects", { name }));
  expect(response.status).toBe(201);
  const result = await response.json();
  return result.project.id as string;
}

beforeEach(async () => {
  oldHosted = process.env.KIVO_HOSTED;
  oldDataDir = process.env.KIVO_DATA_DIR;
  oldVercel = process.env.VERCEL;
  dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kivo-hosted-api-"));
  process.env.KIVO_HOSTED = "true";
  process.env.KIVO_DATA_DIR = dataRoot;
  delete process.env.VERCEL;
});

afterEach(async () => {
  await fs.rm(dataRoot, { recursive: true, force: true });
  if (oldHosted === undefined) delete process.env.KIVO_HOSTED;
  else process.env.KIVO_HOSTED = oldHosted;
  if (oldDataDir === undefined) delete process.env.KIVO_DATA_DIR;
  else process.env.KIVO_DATA_DIR = oldDataDir;
  if (oldVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = oldVercel;
});

describe("hosted storage API", () => {
  it("reports hosted capabilities without revealing the data root", async () => {
    const response = await getCapabilities();
    const body = await response.text();
    expect(body).toContain('"hosted":true');
    expect(body).toContain('"configured":true');
    expect(body).not.toContain(dataRoot);
  });

  it("creates and lists managed projects without returning filesystem paths", async () => {
    const projectId = await createProjectId("Demo");
    const response = await listProjects();
    const body = await response.text();
    expect(body).toContain(projectId);
    expect(body).toContain("Demo");
    expect(body).not.toContain(dataRoot);
  });

  it("rejects path-like managed project names", async () => {
    const response = await createProject(postRequest("http://localhost/api/projects", { name: dataRoot }));
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).not.toContain(dataRoot);
  });

  it("saves and reloads a workflow through the managed project ID", async () => {
    const projectId = await createProjectId();
    const workflow = {
      version: 1,
      name: "Managed workflow",
      directoryPath: "/private/server/path",
      nodes: [],
      edges: [],
    };
    const saveResponse = await saveWorkflow(postRequest("http://localhost/api/workflow", {
      directoryPath: projectId,
      filename: "managed-workflow",
      workflow,
    }));
    const saveBody = await saveResponse.json();
    expect(saveResponse.status).toBe(200);
    expect(saveBody.filePath).toBe(`${projectId}/managed-workflow.json`);
    expect(JSON.stringify(saveBody)).not.toContain(dataRoot);

    const loadResponse = await getWorkflow(getRequest(
      `http://localhost/api/workflow?path=${encodeURIComponent(projectId)}&load=true`
    ));
    const loadBody = await loadResponse.json();
    expect(loadBody.success).toBe(true);
    expect(loadBody.workflow.directoryPath).toBe(projectId);
    expect(JSON.stringify(loadBody)).not.toContain("/private/server/path");
    expect(JSON.stringify(loadBody)).not.toContain(dataRoot);

    const listingResponse = await listWorkflows(getRequest("http://localhost/api/list-workflows"));
    const listingBody = await listingResponse.json();
    expect(listingBody.workflows[0].directoryPath).toBe(projectId);
    expect(JSON.stringify(listingBody)).not.toContain(dataRoot);
  });

  it("maps a display workflow name to a safe hosted filename", async () => {
    const projectId = await createProjectId();
    const response = await saveWorkflow(postRequest("http://localhost/api/workflow", {
      directoryPath: projectId,
      filename: "Demo Project",
      workflow: { version: 1, nodes: [], edges: [], name: "Demo Project" },
    }));
    expect(response.status).toBe(200);
    expect((await response.json()).filePath).toBe(`${projectId}/Demo_Project.json`);
  });

  it.each(["../etc", "/tmp/arbitrary", "relative/path"])("rejects non-ID workflow paths: %s", async (pathValue) => {
    const response = await getWorkflow(getRequest(
      `http://localhost/api/workflow?path=${encodeURIComponent(pathValue)}&load=true`
    ));
    expect(response.status).toBe(400);
  });

  it.each(["../etc", "/tmp/arbitrary", "relative/path"])("rejects arbitrary paths across managed media routes: %s", async (pathValue) => {
    const imageWrite = await saveWorkflowImage(postRequest("http://localhost/api/workflow-images", {
      workflowPath: pathValue,
      imageId: "safe-id",
      imageData: "data:image/png;base64,YQ==",
    }));
    const generationRead = await loadGeneration(postRequest("http://localhost/api/load-generation", {
      directoryPath: pathValue,
      imageId: "safe-id",
    }));
    const generationWrite = await saveGeneration(postRequest("http://localhost/api/save-generation", {
      directoryPath: pathValue,
      image: "data:image/png;base64,YQ==",
    }));
    const list = await listWorkflows(getRequest(
      `http://localhost/api/list-workflows?path=${encodeURIComponent(pathValue)}`
    ));
    expect(imageWrite.status).toBe(400);
    expect(generationRead.status).toBe(400);
    expect(generationWrite.status).toBe(400);
    expect(list.status).toBe(400);
  });

  it("rejects traversal image IDs and never reads through an escaping image symlink", async () => {
    const projectId = await createProjectId();
    const badId = await saveWorkflowImage(postRequest("http://localhost/api/workflow-images", {
      workflowPath: projectId,
      imageId: "../secret",
      imageData: "data:image/png;base64,YQ==",
    }));
    expect(badId.status).toBe(400);

    const projectDirectory = path.join(dataRoot, "projects", projectId);
    const inputDirectory = path.join(projectDirectory, "inputs");
    const outside = path.join(dataRoot, "secret.png");
    await fs.mkdir(inputDirectory, { recursive: true });
    await fs.writeFile(outside, "private media");
    await fs.symlink(outside, path.join(inputDirectory, "leak.png"));
    const response = await getWorkflowImage(getRequest(
      `http://localhost/api/workflow-images?workflowPath=${projectId}&imageId=leak`
    ));
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.notFound).toBe(true);
    expect(body.image).toBeUndefined();
  });

  it("does not read, overwrite, or list workflow files through escaping symlinks", async () => {
    const projectId = await createProjectId();
    const projectDirectory = path.join(dataRoot, "projects", projectId);
    const outside = path.join(dataRoot, "outside-workflow.json");
    await fs.writeFile(outside, JSON.stringify({ version: 1, nodes: [], edges: [], name: "outside" }));
    await fs.symlink(outside, path.join(projectDirectory, "outside.json"));

    const loadResponse = await getWorkflow(getRequest(
      `http://localhost/api/workflow?path=${encodeURIComponent(projectId)}&load=true`
    ));
    expect(loadResponse.status).toBe(404);

    const saveResponse = await saveWorkflow(postRequest("http://localhost/api/workflow", {
      directoryPath: projectId,
      filename: "outside",
      workflow: { version: 1, nodes: [], edges: [], name: "replace" },
    }));
    expect(saveResponse.status).toBe(403);
    expect(JSON.parse(await fs.readFile(outside, "utf-8")).name).toBe("outside");

    const listResponse = await listWorkflows(getRequest("http://localhost/api/list-workflows"));
    expect((await listResponse.json()).workflows).toEqual([]);
  });

  it("rejects writes through an escaping folder symlink", async () => {
    const projectId = await createProjectId();
    const projectDirectory = path.join(dataRoot, "projects", projectId);
    const outside = path.join(dataRoot, "outside");
    await fs.mkdir(outside);
    await fs.symlink(outside, path.join(projectDirectory, "inputs"), "dir");
    const response = await saveWorkflowImage(postRequest("http://localhost/api/workflow-images", {
      workflowPath: projectId,
      imageId: "safe-id",
      imageData: "data:image/png;base64,YQ==",
      folder: "inputs",
    }));
    expect(response.status).toBe(403);
    expect(await fs.readdir(outside)).toEqual([]);
  });

  it("loads generations through a project ID and blocks an escaping file symlink", async () => {
    const projectId = await createProjectId();
    const generations = path.join(dataRoot, "projects", projectId, "generations");
    await fs.mkdir(generations);
    await fs.writeFile(path.join(generations, "safe.png"), "image");
    const safeResponse = await loadGeneration(postRequest("http://localhost/api/load-generation", {
      directoryPath: projectId,
      imageId: "safe",
    }));
    expect((await safeResponse.json()).success).toBe(true);

    const outside = path.join(dataRoot, "private.png");
    await fs.writeFile(outside, "private");
    await fs.symlink(outside, path.join(generations, "escape.png"));
    const escapeResponse = await loadGeneration(postRequest("http://localhost/api/load-generation", {
      directoryPath: projectId,
      imageId: "escape",
    }));
    expect(escapeResponse.status).toBe(403);
  });

  it("saves generated media under generations and returns a relative reference", async () => {
    const projectId = await createProjectId();
    const response = await saveGeneration(postRequest("http://localhost/api/save-generation", {
      directoryPath: projectId,
      folder: "generations",
      image: "data:image/png;base64,YQ==",
      prompt: "tiny image",
    }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.filePath).toBe(`${projectId}/generations/${body.filename}`);
    expect(JSON.stringify(body)).not.toContain(dataRoot);
    expect(await fs.readFile(path.join(dataRoot, "projects", projectId, "generations", body.filename), "utf-8")).toBe("a");
  });

  it.each(["../outside", "/tmp/arbitrary", "relative/path"])("rejects non-ID generated media paths: %s", async (directoryPath) => {
    const response = await saveGeneration(postRequest("http://localhost/api/save-generation", {
      directoryPath,
      image: "data:image/png;base64,YQ==",
    }));
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).not.toContain(dataRoot);
  });

  it("rejects unsafe generation filenames", async () => {
    const projectId = await createProjectId();
    const response = await saveGeneration(postRequest("http://localhost/api/save-generation", {
      directoryPath: projectId,
      image: "data:image/png;base64,YQ==",
      customFilename: "../private",
    }));
    expect(response.status).toBe(400);
  });

  it("rejects a generation folder symlink that escapes its project", async () => {
    const projectId = await createProjectId();
    const projectDirectory = path.join(dataRoot, "projects", projectId);
    const outside = path.join(dataRoot, "outside-generations");
    await fs.mkdir(outside);
    await fs.symlink(outside, path.join(projectDirectory, "generations"), "dir");
    const response = await saveGeneration(postRequest("http://localhost/api/save-generation", {
      directoryPath: projectId,
      image: "data:image/png;base64,YQ==",
    }));
    expect(response.status).toBe(403);
    expect(await fs.readdir(outside)).toEqual([]);
    expect(JSON.stringify(await response.json())).not.toContain(dataRoot);
  });

  it("disables native operating-system endpoints when hosted", async () => {
    const browse = await browseDirectory();
    const openDir = await openDirectory(postRequest("http://localhost/api/open-directory", { path: dataRoot }));
    const openLocalFile = await openFile(postRequest("http://localhost/api/open-file", { filePath: dataRoot }));
    expect(browse.status).toBe(404);
    expect(openDir.status).toBe(404);
    expect(openLocalFile.status).toBe(404);
  });
});
