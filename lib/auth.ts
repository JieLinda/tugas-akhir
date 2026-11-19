import NextAuth from 'next-auth';
import Keycloak from 'next-auth/providers/keycloak';

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
const hasKeycloakConfig = Boolean(
  process.env.KEYCLOAK_CLIENT_ID &&
    process.env.KEYCLOAK_CLIENT_SECRET &&
    process.env.KEYCLOAK_ISSUER
);

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: hasKeycloakConfig
    ? [
        Keycloak({
          clientId: process.env.KEYCLOAK_CLIENT_ID!,
          clientSecret: process.env.KEYCLOAK_CLIENT_SECRET!,
          issuer: process.env.KEYCLOAK_ISSUER!,
        }),
      ]
    : [],
  basePath: basePath === '' ? '/api/auth' : `${basePath}/api/auth`,
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    async signIn({ user }) {
      if (!user.email) return false;
      return true;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.sub as string) || '';
        session.user.isAdmin = (token.isAdmin as boolean) || false;
        session.user.roles = (token.roles as string[]) || [];
        session.user.divisionIds = (token.divisionIds as number[]) || [];
        session.user.departmentIds = (token.departmentIds as number[]) || [];
        session.user.divisionNames = (token.divisionNames as string[]) || [];
        session.user.departmentNames = (token.departmentNames as string[]) || [];
      }

      return session;
    },
    async jwt({ token, account, profile }) {
      if (account) {
        // ONLY the id_token is kept. The session JWT is serialised into the
        // `authjs.session-token` cookie, so everything stored here is sent as a
        // response header on sign-in and on every subsequent request.
        //
        // Keycloak's access_token and refresh_token are 1-3 KB each and were
        // read by nothing in this codebase; together with the org arrays below
        // they pushed the Set-Cookie block past nginx's default
        // proxy_buffer_size, which answers with 502 Bad Gateway on the OAuth
        // callback while every other route keeps working.
        //
        // id_token stays because federated logout needs it as id_token_hint
        // (app/api/auth/federated-logout/route.ts).
        token.idToken = account.id_token;
      }

      const email = token.email || profile?.email;
      if (email && process.env.PORTAL_API_URL) {
        const cacheKey = email as string;
        const cached = userOrgCache.get(cacheKey);
        const now = Date.now();

        if (cached && now - cached.timestamp < CACHE_TTL) {
          token.isAdmin = cached.data.isAdmin || false;
          token.roles = cached.data.roles || [];
          token.divisionIds = cached.data.divisionIds || [];
          token.departmentIds = cached.data.departmentIds || [];
          token.divisionNames = cached.data.divisionNames || [];
          token.departmentNames = cached.data.departmentNames || [];
        } else {
          try {
            const response = await fetch(
              `${process.env.PORTAL_API_URL}/api/user/divisions-departments?email=${encodeURIComponent(cacheKey)}`,
              {
                headers: {
                  'X-Auth-Token': process.env.INTERNAL_API_TOKEN || '',
                },
              }
            );

            if (response.ok) {
              const data = await response.json();
              token.isAdmin = data.isAdmin || false;
              token.roles = data.roles || [];
              token.divisionIds = data.divisionIds || [];
              token.departmentIds = data.departmentIds || [];
              token.divisionNames = data.divisionNames || [];
              token.departmentNames = data.departmentNames || [];
              userOrgCache.set(cacheKey, { data, timestamp: now });
            }
          } catch (error) {
            console.error('Failed to fetch user org data:', error);
          }
        }
      }

      return token;
    },
  },
  pages: {
    signIn: `${basePath}/auth/signin`,
  },
});

export async function getCurrentUser() {
  if (!hasKeycloakConfig) {
    return {
      id: 'system-local-user',
      email: 'system@pulse.local',
      name: 'System User',
      isAdmin: true,
      roles: ['admin'],
      divisionIds: [],
      departmentIds: [],
      divisionNames: [],
      departmentNames: [],
    };
  }

  const session = await auth();
  if (!session?.user?.email) return null;
  return session.user;
}

const userOrgCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000;

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      image?: string | null;
      isAdmin?: boolean;
      roles?: string[];
      divisionIds?: number[];
      departmentIds?: number[];
      divisionNames?: string[];
      departmentNames?: string[];
    };
  }
}
