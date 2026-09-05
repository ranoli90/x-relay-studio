export function callbackPath() {
  return "/api/reddit/oauth/callback";
}

export function redirectUriFromOrigin(origin: string) {
  return `${origin.replace(/\/$/, "")}${callbackPath()}`;
}

export function originFromRequest(request: Request) {
  const url = new URL(request.url);
  const xfHost = request.headers.get("x-forwarded-host");
  const xfProto = request.headers.get("x-forwarded-proto");
  const host = xfHost || request.headers.get("host") || url.host;
  const proto = xfProto || url.protocol.replace(":", "") || "https";
  return `${proto}://${host}`;
}

export function isPlausibleOrigin(origin: string) {
  try {
    const u = new URL(origin);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
