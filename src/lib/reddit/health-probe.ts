/** Official Data API only. Never hit www.reddit.com HTML or unauthenticated JSON. */
export async function probePublicProfile(
  name: string,
  userAgent: string,
  accessToken?: string | null,
): Promise<"visible" | "hidden" | "unknown"> {
  const handle = name.replace(/^u\//i, "").trim();
  if (!handle || !accessToken) return "unknown";
  const url = `https://oauth.reddit.com/user/${encodeURIComponent(handle)}/about`;
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": userAgent,
        Accept: "application/json",
      },
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
    });
    if (res.status === 404) return "hidden";
    if (!res.ok) return "unknown";
    const json = (await res.json()) as { data?: { name?: string } };
    if (json?.data?.name) return "visible";
    return "unknown";
  } catch {
    return "unknown";
  }
}
