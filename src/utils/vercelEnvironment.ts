import { NextResponse } from "next/server";

export function isVercelEnvironment(): boolean {
  return process.env.VERCEL === "1" || typeof process.env.VERCEL_URL === "string";
}

export function unsupportedOnVercelResponse(feature: string): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: `${feature} is only available in local desktop development and is disabled on Vercel deployments.`,
    },
    { status: 501 }
  );
}
