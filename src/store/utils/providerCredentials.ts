import type { ProviderType } from "@/types";

const credentials = new Map<ProviderType, string>();

const apiKeyHeaders: Record<ProviderType, string> = {
  gemini: "X-Gemini-API-Key",
  openai: "X-OpenAI-API-Key",
  anthropic: "X-Anthropic-API-Key",
  replicate: "X-Replicate-API-Key",
  fal: "X-Fal-API-Key",
  kie: "X-Kie-Key",
  wavespeed: "X-WaveSpeed-Key",
};

export function getProviderApiKey(providerId: ProviderType): string | null {
  if (typeof window === "undefined") return null;
  return credentials.get(providerId) ?? null;
}

export function setProviderApiKey(
  providerId: ProviderType,
  apiKey: string | null | undefined
): void {
  if (typeof window === "undefined") return;
  if (apiKey) {
    credentials.set(providerId, apiKey);
  } else {
    credentials.delete(providerId);
  }
}

export function addProviderApiKeyHeader(
  providerId: ProviderType,
  headers?: HeadersInit
): HeadersInit {
  const apiKey = getProviderApiKey(providerId);
  if (!apiKey) return headers ?? {};
  const result = new Headers(headers);
  result.set(apiKeyHeaders[providerId], apiKey);
  return result;
}
