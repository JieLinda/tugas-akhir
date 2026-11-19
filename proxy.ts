import { NextResponse, type NextRequest } from 'next/server';
import { APP_MODE_COOKIE, APP_MODE_PARAM, deploymentModeConfig, parseModeKeyword } from './lib/app-mode-shared';

// The ONLY switch between "mode asli" and "mode demo", by design: a keyword on
// any page URL, never a control in the UI.
//
//   any page?mode=demo   → demo mode on   (session cookie)
//   any page?mode=asli   → back to real
//
// The keyword is consumed: the response is a redirect to the same URL without
// it, so the address bar does not keep advertising the mode. A session cookie
// (no max-age) rather than a persistent one, because nothing on screen says
// which mode is on — a forgotten demo mode ends with the browser session
// instead of greeting a real user days later with masked NPKs and an empty pool.
//
// A deployment can change the default (PULSE_DEFAULT_MODE=demo, read at
// runtime): the cookie then records only a DEPARTURE from that default, so it
// is set to 'real' for `?mode=asli` there and deleted when the browser asks
// for the default again. With PULSE_MODE_LOCKED=1 the keyword is still
// stripped from the URL but changes nothing, and any old cookie is cleared.
export function proxy(request: NextRequest) {
  const url = request.nextUrl;
  if (!url.searchParams.has(APP_MODE_PARAM)) return NextResponse.next();
  const mode = parseModeKeyword(url.searchParams.get(APP_MODE_PARAM));
  if (!mode) return NextResponse.next(); // not a mode switch: leave the request alone

  const { defaultMode, locked } = deploymentModeConfig();
  const clean = url.clone();
  clean.searchParams.delete(APP_MODE_PARAM);
  const res = NextResponse.redirect(clean, 307);
  if (locked || mode === defaultMode) {
    res.cookies.delete(APP_MODE_COOKIE);
  } else {
    res.cookies.set(APP_MODE_COOKIE, mode, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: url.protocol === 'https:',
    });
  }
  return res;
}

export const config = {
  // Pages only: assets and API routes are fetched by the app, never navigated
  // to with a keyword. API routes still READ the cookie (it rides along).
  matcher: ['/((?!_next/|api/|favicon\\.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp|css|js|map)$).*)'],
};
