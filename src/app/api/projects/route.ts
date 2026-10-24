import { NextRequest, NextResponse } from "next/server";
import {
  createManagedProject,
  isHostedStorageMode,
  listManagedProjects,
  readJsonRequest,
  toHostedStorageError,
} from "@/lib/hostedStorage";

function unavailable() {
  return NextResponse.json(
    { success: false, error: "Managed projects are available in hosted mode" },
    { status: 404 }
  );
}

export async function GET() {
  if (!isHostedStorageMode()) return unavailable();
  try {
    return NextResponse.json({ success: true, projects: await listManagedProjects() });
  } catch (error) {
    const storageError = toHostedStorageError(error);
    return NextResponse.json({ success: false, error: storageError.message }, { status: storageError.status });
  }
}

export async function POST(request: NextRequest) {
  if (!isHostedStorageMode()) return unavailable();
  try {
    const body = await readJsonRequest<Record<string, unknown>>(request, 4096);
    const project = await createManagedProject(body?.name);
    return NextResponse.json({ success: true, project }, { status: 201 });
  } catch (error) {
    const storageError = toHostedStorageError(error);
    return NextResponse.json({ success: false, error: storageError.message }, { status: storageError.status });
  }
}
