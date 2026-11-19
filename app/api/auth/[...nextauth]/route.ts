import { NextRequest } from 'next/server'
import { handlers } from '@/lib/auth'

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

function rewriteRequest(request: NextRequest) {
  const { host, pathname } = request.nextUrl;
  const headers = request.headers;
  const detectedHost = headers.get("x-forwarded-host") ?? host;
  const detectedProtocol = process.env.NODE_ENV === "production" ? "https" : "http";
  const url = new URL(
    `${detectedProtocol}://${detectedHost}${basePath}${pathname}${request.nextUrl.search}`,
  );
  return new NextRequest(url, request);
}
export async function GET(request: NextRequest) {
  return await handlers.GET(rewriteRequest(request));
}

export async function POST(request: NextRequest) {
  return await handlers.POST(rewriteRequest(request));
}
