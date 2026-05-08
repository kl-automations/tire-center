/**
 * Check whether a JWT stored in `localStorage` is still valid.
 *
 * Parses the middle (payload) segment of the JWT with `atob`, reads the
 * `exp` claim (seconds since epoch) and compares to the current time.
 * Returns `false` for missing, malformed, or expired tokens — no library
 * is used so this stays dependency-free.
 */
export function hasValidToken(): boolean {
  const token = localStorage.getItem("token");
  if (!token) return false;
  try {
    const [, payload] = token.split(".");
    if (!payload) return false;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const { exp } = JSON.parse(atob(normalized)) as { exp?: number };
    if (typeof exp !== "number") return false;
    return exp * 1000 > Date.now();
  } catch {
    return false;
  }
}
