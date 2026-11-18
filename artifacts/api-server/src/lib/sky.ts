import {
  connectionsTable,
  constellationsTable,
  db,
  labelsTable,
  notesTable,
  starsTable,
  type ConnectionRow,
  type ConstellationRow,
  type NoteRow,
} from "@workspace/db";
import { and, asc, count, eq, sql } from "drizzle-orm";

/** Stars for a user, each with its note count. */
export async function loadStars(userId: string, starId?: number) {
  const noteCounts = db
    .select({
      starId: notesTable.starId,
      n: count(notesTable.id).as("n"),
    })
    .from(notesTable)
    .where(eq(notesTable.userId, userId))
    .groupBy(notesTable.starId)
    .as("note_counts");

  const where =
    starId === undefined
      ? eq(starsTable.userId, userId)
      : and(eq(starsTable.userId, userId), eq(starsTable.id, starId));

  const rows = await db
    .select({
      id: starsTable.id,
      title: starsTable.title,
      x: starsTable.x,
      y: starsTable.y,
      labelId: starsTable.labelId,
      createdAt: starsTable.createdAt,
      updatedAt: starsTable.updatedAt,
      noteCount: sql<number>`coalesce(${noteCounts.n}, 0)`.mapWith(Number),
    })
    .from(starsTable)
    .leftJoin(noteCounts, eq(noteCounts.starId, starsTable.id))
    .where(where)
    .orderBy(asc(starsTable.createdAt), asc(starsTable.id));

  return rows;
}

export async function loadStar(userId: string, starId: number) {
  const [star] = await loadStars(userId, starId);
  return star ?? null;
}

/** Labels for a user, each with how many stars use it. */
export async function loadLabels(userId: string, labelId?: number) {
  const starCounts = db
    .select({
      labelId: starsTable.labelId,
      n: count(starsTable.id).as("n"),
    })
    .from(starsTable)
    .where(eq(starsTable.userId, userId))
    .groupBy(starsTable.labelId)
    .as("star_counts");

  const where =
    labelId === undefined
      ? eq(labelsTable.userId, userId)
      : and(eq(labelsTable.userId, userId), eq(labelsTable.id, labelId));

  return db
    .select({
      id: labelsTable.id,
      name: labelsTable.name,
      color: labelsTable.color,
      createdAt: labelsTable.createdAt,
      starCount: sql<number>`coalesce(${starCounts.n}, 0)`.mapWith(Number),
    })
    .from(labelsTable)
    .leftJoin(starCounts, eq(starCounts.labelId, labelsTable.id))
    .where(where)
    .orderBy(asc(labelsTable.createdAt), asc(labelsTable.id));
}

export function serializeNote(n: NoteRow) {
  return {
    id: n.id,
    starId: n.starId,
    body: n.body,
    createdAt: n.createdAt,
    editedAt: n.editedAt,
  };
}

export function serializeConnection(c: ConnectionRow) {
  return {
    id: c.id,
    fromStarId: c.fromStarId,
    toStarId: c.toStarId,
    createdAt: c.createdAt,
  };
}

export function serializeConstellation(c: ConstellationRow) {
  return {
    id: c.id,
    name: c.name,
    anchorStarId: c.anchorStarId,
    createdAt: c.createdAt,
  };
}

export async function loadConnections(userId: string) {
  const rows = await db
    .select()
    .from(connectionsTable)
    .where(eq(connectionsTable.userId, userId))
    .orderBy(asc(connectionsTable.id));
  return rows.map(serializeConnection);
}

export async function loadConstellations(userId: string) {
  const rows = await db
    .select()
    .from(constellationsTable)
    .where(eq(constellationsTable.userId, userId))
    .orderBy(asc(constellationsTable.id));
  return rows.map(serializeConstellation);
}

export async function starBelongsTo(userId: string, starId: number) {
  const [row] = await db
    .select({ id: starsTable.id })
    .from(starsTable)
    .where(and(eq(starsTable.id, starId), eq(starsTable.userId, userId)));
  return !!row;
}

export async function labelBelongsTo(userId: string, labelId: number) {
  const [row] = await db
    .select({ id: labelsTable.id })
    .from(labelsTable)
    .where(and(eq(labelsTable.id, labelId), eq(labelsTable.userId, userId)));
  return !!row;
}
