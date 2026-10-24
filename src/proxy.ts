import { NextRequest, NextResponse } from "next/server";
import {
  checkHostedCsrf,
  checkHostedRequest,
  hostedRateLimitResponse,
  isHostedMode,
  takeHostedProxyRateLimit,
} from "@/lib/server/hosted-access";

export function proxy(request: NextRequest): NextResponse {
  if (!isHostedMode()) return NextResponse.next();

  const retryAfter = takeHostedProxyRateLimit();
  if (retryAfter !== null) return hostedRateLimitResponse(retryAfter);

  const authResponse = checkHostedRequest(request);
  if (authResponse) return authResponse;

  const csrfResponse = checkHostedCsrf(request);
  if (csrfResponse) return csrfResponse;

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|icon.png|robots.txt|sitemap.xml|sample-images/|template-thumbnails/|tutorial/|banana_icon.png|node-banana.png|kivo-mark.svg).*)",
  ],
};
