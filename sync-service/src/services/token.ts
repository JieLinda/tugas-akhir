import { config } from "../config.js";

let cachedToken: string | null = null;
let expiresAt = 0;

export async function getApiToken(): Promise<string> {
  const now = Date.now() / 1000;
  if (cachedToken && now < expiresAt - 30) {
    return cachedToken;
  }

  const url = `${config.api.baseUrl}${config.api.tokenPath}`;
  const body = new URLSearchParams({
    client_id: config.api.clientId,
    client_secret: config.api.clientSecret,
    grant_type: config.api.grantType,
  });

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!resp.ok) {
    throw new Error(`Token request failed: ${resp.status} ${resp.statusText}`);
  }

  const data = (await resp.json()) as {
    access_token: string;
    expires_in: number;
  };

  cachedToken = data.access_token;
  expiresAt = now + (data.expires_in || 600);
  console.log(`[TOKEN] Refreshed (expires in ${data.expires_in}s)`);

  return cachedToken;
}

export function apiHeaders(token: string): Record<string, string> {
  return {
    client_id: config.api.clientId,
    client_secret: config.api.clientSecret,
    "api-key": token,
    "Content-Type": "application/json",
  };
}
