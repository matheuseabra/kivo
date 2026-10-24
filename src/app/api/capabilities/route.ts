import { NextResponse } from "next/server";
import {
  isHostedStorageConfigured,
  isHostedStorageMode,
} from "@/lib/hostedStorage";

export async function GET() {
  const hosted = isHostedStorageMode();
  return NextResponse.json({
    hosted,
    managedStorage: hosted,
    configured: hosted && isHostedStorageConfigured(),
  });
}
