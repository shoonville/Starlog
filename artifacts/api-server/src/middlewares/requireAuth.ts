import { type NextFunction, type Request, type Response } from "express";

export const GUEST_ID_PREFIX = "guest-";

/** Rejects requests without a signed-in user (real or demo guest). */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Not signed in" });
    return;
  }
  next();
}

export function currentUserId(req: Request): string {
  if (!req.user) throw new Error("requireAuth must run before currentUserId");
  return req.user.id;
}

export function isGuestUser(userId: string): boolean {
  return userId.startsWith(GUEST_ID_PREFIX);
}
