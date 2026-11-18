import { Router, type IRouter } from "express";
import { connectionsTable, constellationsTable, db } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  CreateConnectionBody,
  CreateConnectionResponse,
  CreateConstellationBody,
  CreateConstellationResponse,
  DeleteConnectionParams,
  DeleteConstellationParams,
  UpdateConstellationBody,
  UpdateConstellationParams,
  UpdateConstellationResponse,
} from "@workspace/api-zod";
import { currentUserId, requireAuth } from "../middlewares/requireAuth";
import {
  serializeConnection,
  serializeConstellation,
  starBelongsTo,
} from "../lib/sky";

const router: IRouter = Router();
router.use(["/connections", "/constellations"], requireAuth);

router.post("/connections", async (req, res) => {
  const userId = currentUserId(req);
  const body = CreateConnectionBody.parse(req.body);
  if (body.fromStarId === body.toStarId) {
    res.status(400).json({ error: "A star can't connect to itself" });
    return;
  }
  const [a, b] = [body.fromStarId, body.toStarId].sort((x, y) => x - y) as [
    number,
    number,
  ];
  const [okA, okB] = await Promise.all([
    starBelongsTo(userId, a),
    starBelongsTo(userId, b),
  ]);
  if (!okA || !okB) {
    res.status(400).json({ error: "Unknown star" });
    return;
  }

  const [inserted] = await db
    .insert(connectionsTable)
    .values({ userId, fromStarId: a, toStarId: b })
    .onConflictDoNothing()
    .returning();
  const row =
    inserted ??
    (
      await db
        .select()
        .from(connectionsTable)
        .where(
          and(
            eq(connectionsTable.fromStarId, a),
            eq(connectionsTable.toStarId, b),
          ),
        )
    )[0];
  res.status(201).json(CreateConnectionResponse.parse(serializeConnection(row!)));
});

router.delete("/connections/:connectionId", async (req, res) => {
  const userId = currentUserId(req);
  const { connectionId } = DeleteConnectionParams.parse(req.params);
  const deleted = await db
    .delete(connectionsTable)
    .where(
      and(
        eq(connectionsTable.id, connectionId),
        eq(connectionsTable.userId, userId),
      ),
    )
    .returning({ id: connectionsTable.id });
  if (!deleted.length) {
    res.status(404).json({ error: "Connection not found" });
    return;
  }
  res.status(204).end();
});

router.post("/constellations", async (req, res) => {
  const userId = currentUserId(req);
  const body = CreateConstellationBody.parse(req.body);
  if (!(await starBelongsTo(userId, body.anchorStarId))) {
    res.status(400).json({ error: "Unknown star" });
    return;
  }
  const [row] = await db
    .insert(constellationsTable)
    .values({ userId, name: body.name.trim(), anchorStarId: body.anchorStarId })
    .returning();
  res
    .status(201)
    .json(CreateConstellationResponse.parse(serializeConstellation(row!)));
});

router.patch("/constellations/:constellationId", async (req, res) => {
  const userId = currentUserId(req);
  const { constellationId } = UpdateConstellationParams.parse(req.params);
  const body = UpdateConstellationBody.parse(req.body);
  const [row] = await db
    .update(constellationsTable)
    .set({ name: body.name.trim() })
    .where(
      and(
        eq(constellationsTable.id, constellationId),
        eq(constellationsTable.userId, userId),
      ),
    )
    .returning();
  if (!row) {
    res.status(404).json({ error: "Constellation not found" });
    return;
  }
  res.json(UpdateConstellationResponse.parse(serializeConstellation(row)));
});

router.delete("/constellations/:constellationId", async (req, res) => {
  const userId = currentUserId(req);
  const { constellationId } = DeleteConstellationParams.parse(req.params);
  const deleted = await db
    .delete(constellationsTable)
    .where(
      and(
        eq(constellationsTable.id, constellationId),
        eq(constellationsTable.userId, userId),
      ),
    )
    .returning({ id: constellationsTable.id });
  if (!deleted.length) {
    res.status(404).json({ error: "Constellation not found" });
    return;
  }
  res.status(204).end();
});

export default router;
