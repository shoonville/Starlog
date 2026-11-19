import { type NextFunction, type Request, type Response } from "express";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function firstHeader(v: string | string[] | undefined) {
  return (Array.isArray(v) ? v[0] : v)?.split(",")[0]?.trim().toLowerCase();
}

/**
 * Only this app's own pages may change data. Any request that writes (POST, PATCH, PUT, DELETE) must
 * come from the same host the request was sent to; browsers always send `Origin` on such requests,
 * and `Sec-Fetch-Site` backs it up. Plain page navigations (GET, e.g. the login link) are unaffected.
 * No CORS headers are ever sent, so other sites can't read responses either.
 */
export function sameOrigin(req: Request, res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }
  const host = firstHeader(req.headers["x-forwarded-host"]) ?? firstHeader(req.headers.host);
  const origin = req.headers.origin;
  let ok: boolean;
  if (origin) {
    try {
      ok = origin !== "null" && new URL(origin).host.toLowerCase() === host;
    } catch {
      ok = false;
    }
  } else {
    ok = req.headers["sec-fetch-site"] !== "cross-site";
  }
  if (!ok) {
    req.log.warn({ origin, host }, "Blocked cross-site request");
    res.status(403).json({ error: "Requests must come from Starlog itself" });
    return;
  }
  next();
}
