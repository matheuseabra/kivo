import { NextResponse } from "next/server";
import { isHostedMode } from "@/lib/server/hosted-access";

export interface EnvStatusResponse {
  gemini: boolean;
  openai: boolean;
  anthropic: boolean;
  replicate: boolean;
  fal: boolean;
  kie: boolean;
  wavespeed: boolean;
}

export async function GET() {
  const allowEnvironmentAvailability = !isHostedMode();
  const status: EnvStatusResponse = {
    gemini: allowEnvironmentAvailability && !!process.env.GEMINI_API_KEY,
    openai: allowEnvironmentAvailability && !!process.env.OPENAI_API_KEY,
    anthropic: allowEnvironmentAvailability && !!process.env.ANTHROPIC_API_KEY,
    replicate: allowEnvironmentAvailability && !!process.env.REPLICATE_API_KEY,
    fal: allowEnvironmentAvailability && !!process.env.FAL_API_KEY,
    kie: allowEnvironmentAvailability && !!process.env.KIE_API_KEY,
    wavespeed: allowEnvironmentAvailability && !!process.env.WAVESPEED_API_KEY,
  };

  return NextResponse.json(status);
}
