import crypto from "crypto";
import { Router, type IRouter } from "express";
import { db, usersTable } from "@workspace/db";
import { and, eq, lt } from "drizzle-orm";
import { EndDemoResponse, StartDemoBody, StartDemoResponse } from "@workspace/api-zod";
import {
  SESSION_COOKIE,
  SESSION_TTL,
  clearSession,
  createSession,
  getSessionId,
} from "../lib/auth";
import { seedDemoSky } from "../lib/demoSeed";
import { GUEST_ID_PREFIX, isGuestUser } from "../middlewares/requireAuth";

const router: IRouter = Router();

// Demo guests (and their skies, via cascade) older than this are cleaned up.
const GUEST_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;

router.post("/demo/start", async (req, res) => {
  const { tz } = StartDemoBody.parse(req.body ?? {});
  // Opportunistic cleanup of stale guest skies.
  await db
    .delete(usersTable)
    .where(
      and(
        eq(usersTable.isGuest, true),
        lt(usersTable.createdAt, new Date(Date.now() - GUEST_MAX_AGE_MS)),
      ),
    );

  // If this browser already holds a guest session, drop that guest first.
  const existingSid = getSessionId(req);
  if (req.user && isGuestUser(req.user.id)) {
    await db.delete(usersTable).where(eq(usersTable.id, req.user.id));
  }
  if (existingSid) await clearSession(res, existingSid);

  const guestId = `${GUEST_ID_PREFIX}${crypto.randomUUID()}`;
  await db.transaction(async (tx) => {
    await tx.insert(usersTable).values({
      id: guestId,
      firstName: "Stargazer",
      isGuest: true,
    });
    await seedDemoSky(tx, guestId, tz);
  });

  const sid = await createSession({
    user: {
      id: guestId,
      email: null,
      firstName: "Stargazer",
      lastName: null,
      profileImageUrl: null,
    },
    access_token: "",
  });
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL,
  });

  req.log.info("Started demo sky");
  res.json(StartDemoResponse.parse({ success: true, isDemo: true }));
});

router.post("/demo/end", async (req, res) => {
  const sid = getSessionId(req);
  if (req.user && isGuestUser(req.user.id)) {
    await db.delete(usersTable).where(eq(usersTable.id, req.user.id));
  }
  if (sid && req.user && isGuestUser(req.user.id)) {
    await clearSession(res, sid);
  }
  res.json(EndDemoResponse.parse({ success: true }));
});

export default router;
