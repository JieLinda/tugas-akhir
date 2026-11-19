'use client';

import { SessionProvider } from 'next-auth/react';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  if (process.env.NEXT_PUBLIC_DISABLE_AUTH !== 'false') {
    return <>{children}</>;
  }

  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
  const authBasePath = basePath ? `${basePath}/api/auth` : "/api/auth";

  return <SessionProvider basePath={authBasePath}>{children}</SessionProvider>;
}
