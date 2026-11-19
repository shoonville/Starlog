import { Router, type IRouter } from "express";
import { db, starsTable, tasksTable, type TaskRow } from "@workspace/db";
import { and, eq, inArray, max, sql } from "drizzle-orm";
import {
  CreateTaskBody,
  CreateTaskParams,
  CreateTaskResponse,
  DeleteTaskParams,
  SetTaskOrderBody,
  SetTaskOrderParams,
  UpdateTaskBody,
  UpdateTaskParams,
  UpdateTaskResponse,
} from "@workspace/api-zod";
import { currentUserId, requireAuth } from "../middlewares/requireAuth";
import { serializeTask, starBelongsTo } from "../lib/sky";
import { nextDueDate } from "../lib/taskDates";

const router: IRouter = Router();
router.use(["/tasks", "/stars/:starId/tasks", "/stars/:starId/task-order"], requireAuth);

async function nextPosition(starId: number) {
  const [row] = await db
    .select({ p: max(tasksTable.position) })
    .from(tasksTable)
    .where(eq(tasksTable.starId, starId));
  return (row?.p ?? -1) + 1;
}

router.post("/stars/:starId/tasks", async (req, res) => {
  const userId = currentUserId(req);
  const { starId } = CreateTaskParams.parse(req.params);
  const body = CreateTaskBody.parse(req.body);
  if (!(await starBelongsTo(userId, starId))) {
    res.status(404).json({ error: "Star not found" });
    return;
  }
  const [task] = await db
    .insert(tasksTable)
    .values({
      userId,
      starId,
      title: body.title.trim(),
      dueDate: body.dueDate ?? null,
      priority: body.priority ?? "normal",
      repeat: body.repeat ?? null,
      position: await nextPosition(starId),
    })
    .returning();
  res.status(201).json(CreateTaskResponse.parse(serializeTask(task!)));
});

router.patch("/tasks/:taskId", async (req, res) => {
  const userId = currentUserId(req);
  const { taskId } = UpdateTaskParams.parse(req.params);
  const body = UpdateTaskBody.parse(req.body);

  const [existing] = await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.id, taskId), eq(tasksTable.userId, userId)));
  if (!existing) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  const patch: Partial<typeof tasksTable.$inferInsert> = {};
  if (body.title !== undefined) patch.title = body.title.trim() || existing.title;
  if (body.dueDate !== undefined) patch.dueDate = body.dueDate;
  if (body.priority !== undefined) patch.priority = body.priority;
  if (body.repeat !== undefined) patch.repeat = body.repeat;
  if (body.done !== undefined && body.done !== existing.done) {
    patch.done = body.done;
    patch.doneAt = body.done ? new Date() : null;
  }

  const repeat = patch.repeat !== undefined ? patch.repeat : existing.repeat;
  const spawn = patch.done === true && repeat != null && !existing.spawnedNext;
  if (spawn) patch.spawnedNext = true;

  const result = await db.transaction(async (tx) => {
    const [task] = Object.keys(patch).length
      ? await tx.update(tasksTable).set(patch).where(eq(tasksTable.id, taskId)).returning()
      : [existing];
    let next: TaskRow | null = null;
    if (spawn) {
      const due = patch.dueDate !== undefined ? patch.dueDate : existing.dueDate;
      const [row] = await tx
        .insert(tasksTable)
        .values({
          userId,
          starId: existing.starId,
          title: task!.title,
          dueDate: nextDueDate(due ?? null, repeat as "daily" | "weekly" | "monthly", body.today),
          priority: task!.priority,
          repeat,
          position: existing.position,
        })
        .returning();
      next = row ?? null;
    }
    return { task: task!, next };
  });

  res.json(
    UpdateTaskResponse.parse({
      task: serializeTask(result.task),
      next: result.next ? serializeTask(result.next) : null,
    }),
  );
});

router.delete("/tasks/:taskId", async (req, res) => {
  const userId = currentUserId(req);
  const { taskId } = DeleteTaskParams.parse(req.params);
  const deleted = await db
    .delete(tasksTable)
    .where(and(eq(tasksTable.id, taskId), eq(tasksTable.userId, userId)))
    .returning({ id: tasksTable.id });
  if (!deleted.length) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  res.status(204).end();
});

router.put("/stars/:starId/task-order", async (req, res) => {
  const userId = currentUserId(req);
  const { starId } = SetTaskOrderParams.parse(req.params);
  const { order } = SetTaskOrderBody.parse(req.body);
  if (!(await starBelongsTo(userId, starId))) {
    res.status(404).json({ error: "Star not found" });
    return;
  }
  await db.transaction(async (tx) => {
    await tx
      .update(starsTable)
      .set({ taskOrder: order ? "manual" : "auto", updatedAt: sql`${starsTable.updatedAt}` as unknown as Date })
      .where(eq(starsTable.id, starId));
    if (!order?.length) return;
    const owned = await tx
      .select({ id: tasksTable.id })
      .from(tasksTable)
      .where(and(eq(tasksTable.starId, starId), inArray(tasksTable.id, order)));
    const ok = new Set(owned.map((t) => t.id));
    let i = 0;
    for (const id of order) {
      if (!ok.has(id)) continue;
      await tx.update(tasksTable).set({ position: i++ }).where(eq(tasksTable.id, id));
    }
  });
  res.status(204).end();
});

export default router;
