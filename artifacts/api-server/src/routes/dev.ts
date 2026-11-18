import { Router, type IRouter } from "express";
import {
  connectionsTable,
  db,
  labelsTable,
  notesTable,
  starsTable,
} from "@workspace/db";
import { and, count, eq, sql } from "drizzle-orm";
import {
  AddStressStarsBody,
  AddStressStarsResponse,
  RemoveStressStarsResponse,
} from "@workspace/api-zod";
import { currentUserId, requireAuth } from "../middlewares/requireAuth";

// Hidden developer tools: fill a sky with random test stars to check that
// rendering stays smooth, then remove them again.

const router: IRouter = Router();
router.use("/dev", requireAuth);

const TITLE_PREFIX = "Stress test ";
const TITLE_PATTERN = "^Stress test [0-9]+$";
const MAX_STARS_PER_SKY = 3000;

const SAMPLE_NOTES = [
  "A quick thought to give this star some weight.",
  "Another line, written while testing.",
  "Checking how the sky handles a busier night.",
  "Notes make stars grow a little brighter.",
];

router.post("/dev/stress-stars", async (req, res) => {
  const userId = currentUserId(req);
  const body = AddStressStarsBody.parse(req.body);

  const [{ n: existing } = { n: 0 }] = await db
    .select({ n: count(starsTable.id) })
    .from(starsTable)
    .where(eq(starsTable.userId, userId));
  const room = Math.max(0, MAX_STARS_PER_SKY - existing);
  const howMany = Math.min(body.count, room);
  if (howMany === 0) {
    res.status(400).json({ error: "This sky already has as many stars as it can hold" });
    return;
  }

  const labels = await db
    .select({ id: labelsTable.id })
    .from(labelsTable)
    .where(eq(labelsTable.userId, userId));

  const [{ n: prior } = { n: 0 }] = await db
    .select({ n: count(starsTable.id) })
    .from(starsTable)
    .where(and(eq(starsTable.userId, userId), sql`${starsTable.title} ~ ${TITLE_PATTERN}`));

  await db.transaction(async (tx) => {
    const now = Date.now();
    const rows = Array.from({ length: howMany }, (_, i) => {
      // Spread over a wide disc, denser toward the middle.
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.sqrt(Math.random()) * 2600;
      const createdAt = new Date(now - Math.random() * 120 * 24 * 60 * 60 * 1000);
      return {
        userId,
        title: `${TITLE_PREFIX}${prior + i + 1}`,
        x: Math.round(Math.cos(angle) * dist),
        y: Math.round(Math.sin(angle) * dist),
        labelId:
          labels.length && Math.random() < 0.75
            ? labels[Math.floor(Math.random() * labels.length)]!.id
            : null,
        createdAt,
        updatedAt: createdAt,
      };
    });
    const stars = await tx
      .insert(starsTable)
      .values(rows)
      .returning({ id: starsTable.id, x: starsTable.x, y: starsTable.y, createdAt: starsTable.createdAt });

    const notes = stars.flatMap((s) => {
      const n = Math.floor(Math.random() * 6);
      return Array.from({ length: n }, (_, k) => ({
        userId,
        starId: s.id,
        body: SAMPLE_NOTES[(s.id + k) % SAMPLE_NOTES.length]!,
        createdAt: new Date(s.createdAt.getTime() + (k + 1) * 60 * 60 * 1000),
      }));
    });
    if (notes.length) await tx.insert(notesTable).values(notes);

    // Link roughly half the stars to a nearby neighbour.
    const links = new Map<string, { userId: string; fromStarId: number; toStarId: number }>();
    for (const s of stars) {
      if (Math.random() < 0.5) continue;
      let best: (typeof stars)[number] | null = null;
      let bestD = Infinity;
      for (let j = 0; j < 12; j++) {
        const o = stars[Math.floor(Math.random() * stars.length)]!;
        if (o.id === s.id) continue;
        const d = Math.hypot(o.x - s.x, o.y - s.y);
        if (d < bestD) {
          bestD = d;
          best = o;
        }
      }
      if (!best) continue;
      const [from, to] = s.id < best.id ? [s.id, best.id] : [best.id, s.id];
      links.set(`${from}-${to}`, { userId, fromStarId: from, toStarId: to });
    }
    if (links.size) {
      await tx.insert(connectionsTable).values([...links.values()]).onConflictDoNothing();
    }
  });

  req.log.info({ count: howMany }, "Added stress-test stars");
  res.json(AddStressStarsResponse.parse({ count: howMany }));
});

router.delete("/dev/stress-stars", async (req, res) => {
  const userId = currentUserId(req);
  const removed = await db
    .delete(starsTable)
    .where(and(eq(starsTable.userId, userId), sql`${starsTable.title} ~ ${TITLE_PATTERN}`))
    .returning({ id: starsTable.id });
  res.json(RemoveStressStarsResponse.parse({ count: removed.length }));
});

export default router;
