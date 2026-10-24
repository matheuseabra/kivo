export interface StorageCapabilities {
  hosted: boolean;
  managedStorage: boolean;
  configured: boolean;
}

export interface ManagedProject {
  id: string;
  name: string;
  updatedAt: number;
}

export async function fetchStorageCapabilities(): Promise<StorageCapabilities> {
  const response = await fetch("/api/capabilities");
  if (!response.ok) throw new Error("Could not load storage capabilities");
  const result = await response.json() as Partial<StorageCapabilities>;
  return {
    hosted: result.hosted === true,
    managedStorage: result.managedStorage === true,
    configured: result.configured === true,
  };
}

export async function fetchManagedProjects(): Promise<ManagedProject[]> {
  const response = await fetch("/api/projects");
  const result = await response.json();
  if (!response.ok || result.success !== true || !Array.isArray(result.projects)) {
    throw new Error(result.error || "Could not load projects");
  }
  return result.projects as ManagedProject[];
}

export async function createManagedProject(name: string): Promise<ManagedProject> {
  const response = await fetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const result = await response.json();
  if (!response.ok || result.success !== true || !result.project) {
    throw new Error(result.error || "Could not create project");
  }
  return result.project as ManagedProject;
}
