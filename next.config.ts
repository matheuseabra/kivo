import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: "100mb", // Increased for large media files
    },
  },
  outputFileTracingExcludes: {
    "/api/browse-directory": [
      ".git/**/*",
      "examples/**/*",
      "public/**/*",
      "logs/**/*",
      "*.md",
    ],
    "/api/list-workflows": [
      ".git/**/*",
      "examples/**/*",
      "public/**/*",
      "logs/**/*",
      "*.md",
    ],
    "/api/load-generation": [
      ".git/**/*",
      "examples/**/*",
      "public/**/*",
      "logs/**/*",
      "*.md",
    ],
    "/api/open-directory": [
      ".git/**/*",
      "examples/**/*",
      "public/**/*",
      "logs/**/*",
      "*.md",
    ],
    "/api/open-file": [
      ".git/**/*",
      "examples/**/*",
      "public/**/*",
      "logs/**/*",
      "*.md",
    ],
    "/api/save-generation": [
      ".git/**/*",
      "examples/**/*",
      "public/**/*",
      "logs/**/*",
      "*.md",
    ],
    "/api/workflow": [
      ".git/**/*",
      "examples/**/*",
      "public/**/*",
      "logs/**/*",
      "*.md",
    ],
    "/api/workflow-images": [
      ".git/**/*",
      "examples/**/*",
      "public/**/*",
      "logs/**/*",
      "*.md",
    ],
  },
  // Note: For route handlers (.../route.ts files), body size is controlled by
  // the underlying server. For large payloads, consider using streaming or
  // increase Node.js max HTTP header size if needed.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
