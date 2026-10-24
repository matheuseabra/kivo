# Hosted project storage

Hosted storage supports a single owner on an authenticated Kivo VM. It stores workflow files and media below a server-managed directory. It does not add multi-user ownership or remote job recovery.

## Enable hosted mode

Set these server environment variables:

```sh
KIVO_HOSTED=true
KIVO_DATA_DIR=/var/lib/kivo
```

`KIVO_HOSTED` must be exactly `true`. `KIVO_DATA_DIR` must be an absolute path to a dedicated, writable directory on persistent storage. Do not point it at the filesystem root, the application checkout, or a temporary directory. Keep the volume outside the web root. The service account needs permission to create and update files there.

Hosted mode requires the application to sit behind the configured authentication gateway. Protect the VM with TLS and keep the data volume private. The capability response reports whether the root is configured. It never returns the root path.

## Managed projects

The project settings screen creates a managed project or selects an existing one. The browser stores and sends the opaque project ID. The server maps that ID below:

```text
$KIVO_DATA_DIR/projects/<project-id>/
  .project.json
  <workflow-name>.json
  inputs/
  generations/
```

Workflow files, uploaded images, and generated media stay within the selected project directory. Hosted API responses return project IDs or relative media names. They do not return absolute paths from the VM.

The server rejects arbitrary paths in hosted mode. It checks resolved paths before file operations and refuses symlinks that escape a managed project. Project IDs, workflow filenames, image IDs, and media folder names are validated.

## Hosted behavior and limits

The native folder picker and operating-system file reveal endpoints are disabled in hosted mode. Use the project selector in Project Settings and the managed workflow browser. Workflow export remains a browser download.

Hosted storage limits workflow JSON requests to 25 MiB, image requests to 35 MiB, generation requests to 136 MiB, uploaded image files to 24 MiB, and generated media files to 100 MiB. It lists at most 500 managed projects and reads at most 1,000 workflow-directory entries per project request. It checks available disk space before writes. These limits reduce accidental oversized writes; they do not provide a per-account quota. Monitor disk space and configure volume alerts and backups on the VM.

When `KIVO_HOSTED` is unset or not `true`, the app keeps its local absolute-directory workflow. Do not use that mode for a remotely exposed VM.
