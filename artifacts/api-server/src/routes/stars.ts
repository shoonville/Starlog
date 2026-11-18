import { Router, type IRouter } from "express";
import {
  connectionsTable,
  constellationsTable,
  db,
  notesTable,
  starsTable,
} from "@workspace/db";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import {
  CreateNoteBody,
  CreateNoteParams,
  CreateNoteResponse,
  CreateStarBody,
  CreateStarResponse,
  DeleteNoteParams,
  DeleteStarParams,
  ListStarNotesParams,
  ListStarNotesResponse,
  UpdateNoteBody,
  UpdateNoteParams,
  UpdateNoteResponse,
  UpdateStarBody,
  UpdateStarParams,
  UpdateStarResponse,
} from "@workspace/api-zod";
import { currentUserId, requireAuth } from "../middlewares/requireAuth";
import {
  labelBelongsTo,
  loadStar,
  serializeNote,
  starBelongsTo,
} from "../lib/sky";

const router: IRouter = Router();
router.use(["/stars", "/notes"], requireAuth);

router.post("/stars", async (req, res) => {
  const userId = currentUserId(req);
  const body = CreateStarBody.parse(req.body);
  if (body.labelId != null && !(await labelBelongsTo(userId, body.labelId))) {
    res.status(400).json({ error: "Unknown label" });
    return;
  }
  const [row] = await db
    .insert(starsTable)
    .values({
      userId,
      title: body.title?.trim() || "Untitled star",
      x: body.x,
      y: body.y,
      labelId: body.labelId ?? null,
    })
    .returning();
  const star = await loadStar(userId, row!.id);
  res.status(201).json(CreateStarResponse.parse(star));
});

router.patch("/stars/:starId", async (req, res) => {
  const userId = currentUserId(req);
  const { starId } = UpdateStarParams.parse(req.params);
  const body = UpdateStarBody.parse(req.body);
  if (body.labelId != null && !(await labelBelongsTo(userId, body.labelId))) {
    res.status(400).json({ error: "Unknown label" });
    return;
  }

  const patch: Partial<typeof starsTable.$inferInsert> = {};
  if (body.title !== undefined) patch.title = body.title.trim() || "Untitled star";
  if (body.x !== undefined) patch.x = body.x;
  if (body.y !== undefined) patch.y = body.y;
  if (body.labelId !== undefined) patch.labelId = body.labelId;

  if (Object.keys(patch).length) {
    const updated = await db
      .update(starsTable)
      .set(patch)
      .where(and(eq(starsTable.id, starId), eq(starsTable.userId, userId)))
      .returning({ id: starsTable.id });
    if (!updated.length) {
      res.status(404).json({ error: "Star not found" });
      return;
    }
  }

  const star = await loadStar(userId, starId);
  if (!star) {
    res.status(404).json({ error: "Star not found" });
    return;
  }
  res.json(UpdateStarResponse.parse(star));
});

router.delete("/stars/:starId", async (req, res) => {
  const userId = currentUserId(req);
  const { starId } = DeleteStarParams.parse(req.params);
  if (!(await starBelongsTo(userId, starId))) {
    res.status(404).json({ error: "Star not found" });
    return;
  }

  await db.transaction(async (tx) => {
    // Keep constellation names alive: re-anchor any constellation anchored on
    // this star to one of its connected neighbours before the star goes away.
    const anchored = await tx
      .select({ id: constellationsTable.id })
      .from(constellationsTable)
      .where(eq(constellationsTable.anchorStarId, starId));
    if (anchored.length) {
      const neighbours = await tx
        .select()
        .from(connectionsTable)
        .where(
          or(
            eq(connectionsTable.fromStarId, starId),
            eq(connectionsTable.toStarId, starId),
          ),
        )
        .orderBy(asc(connectionsTable.id));
      const next = neighbours
        .map((c) => (c.fromStarId === starId ? c.toStarId : c.fromStarId))
        .find((id) => id !== starId);
      if (next !== undefined) {
        await tx
          .update(constellationsTable)
          .set({ anchorStarId: next })
          .where(
            inArray(
              constellationsTable.id,
              anchored.map((a) => a.id),
            ),
          );
      }
    }
    await tx
      .delete(starsTable)
      .where(and(eq(starsTable.id, starId), eq(starsTable.userId, userId)));
  });

  res.status(204).end();
});

router.get("/stars/:starId/notes", async (req, res) => {
  const userId = currentUserId(req);
  const { starId } = ListStarNotesParams.parse(req.params);
  if (!(await starBelongsTo(userId, starId))) {
    res.status(404).json({ error: "Star not found" });
    return;
  }
  const notes = await db
    .select()
    .from(notesTable)
    .where(and(eq(notesTable.starId, starId), eq(notesTable.userId, userId)))
    .orderBy(asc(notesTable.createdAt), asc(notesTable.id));
  res.json(ListStarNotesResponse.parse(notes.map(serializeNote)));
});

router.post("/stars/:starId/notes", async (req, res) => {
  const userId = currentUserId(req);
  const { starId } = CreateNoteParams.parse(req.params);
  const body = CreateNoteBody.parse(req.body);
  if (!(await starBelongsTo(userId, starId))) {
    res.status(404).json({ error: "Star not found" });
    return;
  }
  const [note] = await db
    .insert(notesTable)
    .values({ userId, starId, body: body.body })
    .returning();
  await db
    .update(starsTable)
    .set({ updatedAt: new Date() })
    .where(eq(starsTable.id, starId));
  res.status(201).json(CreateNoteResponse.parse(serializeNote(note!)));
});

router.patch("/notes/:noteId", async (req, res) => {
  const userId = currentUserId(req);
  const { noteId } = UpdateNoteParams.parse(req.params);
  const body = UpdateNoteBody.parse(req.body);

  const [existing] = await db
    .select()
    .from(notesTable)
    .where(and(eq(notesTable.id, noteId), eq(notesTable.userId, userId)));
  if (!existing) {
    res.status(404).json({ error: "Note not found" });
    return;
  }
  if (existing.body === body.body) {
    res.json(UpdateNoteResponse.parse(serializeNote(existing)));
    return;
  }

  const [note] = await db
    .update(notesTable)
    .set({ body: body.body, editedAt: new Date() })
    .where(eq(notesTable.id, noteId))
    .returning();
  res.json(UpdateNoteResponse.parse(serializeNote(note!)));
});

router.delete("/notes/:noteId", async (req, res) => {
  const userId = currentUserId(req);
  const { noteId } = DeleteNoteParams.parse(req.params);
  const deleted = await db
    .delete(notesTable)
    .where(and(eq(notesTable.id, noteId), eq(notesTable.userId, userId)))
    .returning({ id: notesTable.id });
  if (!deleted.length) {
    res.status(404).json({ error: "Note not found" });
    return;
  }
  res.status(204).end();
});

export default router;
