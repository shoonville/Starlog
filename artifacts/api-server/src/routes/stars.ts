import { Router, type IRouter } from "express";
import {
  connectionsTable,
  constellationsTable,
  db,
  notesTable,
  starsTable,
} from "@workspace/db";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
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

/** Marks a star as recently edited (used by the recent list). */
async function touchStar(starId: number) {
  await db
    .update(starsTable)
    .set({ updatedAt: new Date() })
    .where(eq(starsTable.id, starId));
}
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
  // Moving a star isn't "editing" it: keep updatedAt so the recent list
  // only reflects writing, renaming and relabeling.
  if (body.title === undefined && body.labelId === undefined) {
    patch.updatedAt = sql`${starsTable.updatedAt}` as unknown as Date;
  }

  if (body.title !== undefined || body.x !== undefined || body.y !== undefined || body.labelId !== undefined) {
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
  await touchStar(starId);
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
  const bodyChanged = body.body !== undefined && body.body !== existing.body;
  const pinChanged = body.pinned !== undefined && body.pinned !== existing.pinned;
  if (!bodyChanged && !pinChanged) {
    res.json(UpdateNoteResponse.parse(serializeNote(existing)));
    return;
  }

  // Pinning isn't writing, so it neither marks the note edited nor bumps the star.
  const [note] = await db
    .update(notesTable)
    .set({
      ...(bodyChanged ? { body: body.body, editedAt: new Date() } : {}),
      ...(pinChanged ? { pinned: body.pinned } : {}),
    })
    .where(eq(notesTable.id, noteId))
    .returning();
  if (bodyChanged) await touchStar(note!.starId);
  res.json(UpdateNoteResponse.parse(serializeNote(note!)));
});

router.delete("/notes/:noteId", async (req, res) => {
  const userId = currentUserId(req);
  const { noteId } = DeleteNoteParams.parse(req.params);
  const deleted = await db
    .delete(notesTable)
    .where(and(eq(notesTable.id, noteId), eq(notesTable.userId, userId)))
    .returning({ id: notesTable.id, starId: notesTable.starId });
  if (!deleted.length) {
    res.status(404).json({ error: "Note not found" });
    return;
  }
  await touchStar(deleted[0]!.starId);
  res.status(204).end();
});

export default router;
