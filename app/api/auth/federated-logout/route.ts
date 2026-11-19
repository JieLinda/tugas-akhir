import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { signOut } from '@/lib/auth';

// RP-initiated (front-channel) logout.
//
// next-auth's signOut() only clears OUR session cookie — it never tells Keycloak
// anything, so the Keycloak SSO session survives. Signing back in then hits
// "You are already authenticated as different user '<x>' in this session.
// Please sign out first." because Keycloak still holds a live session for the
// previous user.
//
// Fix: clear the local session AND redirect the browser to Keycloak's
// end_session_endpoint, which is the only thing that drops the Keycloak SSO
// cookie. id_token_hint is what lets Keycloak skip its logout confirmation
// screen, so we read the token BEFORE signOut() deletes the cookie it lives in.

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

/**
 * Auth.js v5 session cookie names, including the chunked variants.
 *
 * On https BOTH spellings are cleared: the `__Secure-` one Auth.js is using now,
 * and the bare one a session may still carry from before TLS was in front of the
 * app. Clearing a cookie that does not exist costs nothing; missing one leaves
 * the user signed in.
 */
function sessionCookieNames(secure: boolean): string[] {
  const bases = secure
    ? ['__Secure-authjs.session-token', 'authjs.session-token']
    : ['authjs.session-token'];
  return bases.flatMap((base) => [base, `${base}.0`, `${base}.1`, `${base}.2`, `${base}.3`]);
}

/**
 * The origin the BROWSER used, not the one this process is bound to.
 *
 * Behind the nginx container, req.nextUrl.origin is the internal listen address
 * — "http://0.0.0.0:3000". Using it produced
 * `post_logout_redirect_uri=http://0.0.0.0:3000/pulse`, which Keycloak rejects
 * with "Invalid redirect uri" because that URL is (rightly) not registered on
 * the client. It also reported the scheme as http, so the `__Secure-` session
 * cookies were looked up under the wrong names and the id_token_hint went
 * missing.
 *
 * AUTH_URL is consulted FIRST, before the forwarded headers. It is the operator's
 * declared public URL — the same one registered on the Keycloak client — so it
 * is the only source that cannot be wrong by accident. Headers are second-guess
 * material: when TLS is terminated by an outer load balancer, the inner nginx
 * sees a plain connection and forwards `X-Forwarded-Proto: http`, which produced
 * `post_logout_redirect_uri=http://dev-aira.mpm-motor.com/pulse` and another
 * "Invalid redirect uri" even though the host was right.
 */
function publicOrigin(req: NextRequest): string {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (host) {
    const proto = (process.env.NODE_ENV === 'production' ? 'https' : req.nextUrl.protocol.replace(':', ''));
    // x-forwarded-proto can arrive as a list ("https, http") through >1 proxy.
    return `${proto.split(',')[0]!.trim()}://${host.split(',')[0]!.trim()}`;
  }
  const configured = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // Malformed AUTH_URL — fall through to the headers.
    }
  }
  
  return req.nextUrl.origin;
}

export async function GET(req: NextRequest) {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  const issuer = process.env.KEYCLOAK_ISSUER;
  const origin = publicOrigin(req);
  // Must reflect the PUBLIC scheme: Auth.js names the cookie `__Secure-...`
  // based on the browser-facing URL, so deciding from the internal request
  // would read (and clear) cookies that do not exist.
  const secure = origin.startsWith('https:');

  // Must happen first: signOut() below deletes the cookie getToken() reads.
  let idToken: string | undefined;
  if (secret) {
    try {
      const token = await getToken({ req, secret, secureCookie: secure });
      idToken = token?.idToken as string | undefined;
    } catch {
      // Unreadable token just means no id_token_hint — logout still proceeds.
    }
  }

  try {
    await signOut({ redirect: false });
  } catch {
    // Cookies are also expired explicitly on the response below.
  }

  // Trailing slash matters: Keycloak compares post_logout_redirect_uri against
  // the client's registered list literally, so "/pulse" and "/pulse/" are
  // different entries. new URL('/pulse', origin) yields the no-slash form.
  const home = new URL(basePath || '/', origin).toString();

  // No Keycloak configured (local System User mode) — nothing to end upstream.
  const target = issuer
    ? (() => {
        const end = new URL(`${issuer.replace(/\/$/, '')}/protocol/openid-connect/logout`);
        end.searchParams.set('post_logout_redirect_uri', home);
        // Keycloak requires one of these two; id_token_hint additionally skips
        // the confirmation prompt.
        if (idToken) end.searchParams.set('id_token_hint', idToken);
        else if (process.env.KEYCLOAK_CLIENT_ID) {
          end.searchParams.set('client_id', process.env.KEYCLOAK_CLIENT_ID);
        }
        return end.toString();
      })()
    : home;

  const res = NextResponse.redirect(target);
  // Belt and braces: signOut()'s cookie mutation and this redirect response are
  // produced separately, so expire the session cookies here too.
  //
  // `secure` is NOT optional here. A cookie named `__Secure-…` may only be set
  // with the Secure attribute — without it the browser discards the whole
  // Set-Cookie header, so the deletion silently did nothing and the user came
  // back from Keycloak still signed in. The other attributes are included so the
  // expiry matches the cookie Auth.js originally wrote.
  for (const name of sessionCookieNames(secure)) {
    res.cookies.set(name, '', {
      path: '/',
      maxAge: 0,
      httpOnly: true,
      sameSite: 'lax',
      secure: name.startsWith('__Secure-') ? true : secure,
    });
  }
  return res;
}
