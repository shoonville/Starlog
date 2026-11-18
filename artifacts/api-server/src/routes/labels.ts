import { Router, type IRouter } from "express";
import { db, labelsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  CreateLabelBody,
  CreateLabelResponse,
  DeleteLabelParams,
  ListLabelsResponse,
  UpdateLabelBody,
  UpdateLabelParams,
  UpdateLabelResponse,
} from "@workspace/api-zod";
import { currentUserId, requireAuth } from "../middlewares/requireAuth";
import { loadLabels } from "../lib/sky";

const router: IRouter = Router();
router.use("/labels", requireAuth);

router.get("/labels", async (req, res) => {
  res.json(ListLabelsResponse.parse(await loadLabels(currentUserId(req))));
});

router.post("/labels", async (req, res) => {
  const userId = currentUserId(req);
  const body = CreateLabelBody.parse(req.body);
  const [row] = await db
    .insert(labelsTable)
    .values({ userId, name: body.name.trim(), color: body.color.toUpperCase() })
    .returning();
  const [label] = await loadLabels(userId, row!.id);
  res.status(201).json(CreateLabelResponse.parse(label));
});

router.patch("/labels/:labelId", async (req, res) => {
  const userId = currentUserId(req);
  const { labelId } = UpdateLabelParams.parse(req.params);
  const body = UpdateLabelBody.parse(req.body);

  const patch: Partial<typeof labelsTable.$inferInsert> = {};
  if (body.name !== undefined) patch.name = body.name.trim();
  if (body.color !== undefined) patch.color = body.color.toUpperCase();

  if (Object.keys(patch).length) {
    await db
      .update(labelsTable)
      .set(patch)
      .where(and(eq(labelsTable.id, labelId), eq(labelsTable.userId, userId)));
  }
  const [label] = await loadLabels(userId, labelId);
  if (!label) {
    res.status(404).json({ error: "Label not found" });
    return;
  }
  res.json(UpdateLabelResponse.parse(label));
});

router.delete("/labels/:labelId", async (req, res) => {
  const userId = currentUserId(req);
  const { labelId } = DeleteLabelParams.parse(req.params);
  const deleted = await db
    .delete(labelsTable)
    .where(and(eq(labelsTable.id, labelId), eq(labelsTable.userId, userId)))
    .returning({ id: labelsTable.id });
  if (!deleted.length) {
    res.status(404).json({ error: "Label not found" });
    return;
  }
  res.status(204).end();
});

export default router;
