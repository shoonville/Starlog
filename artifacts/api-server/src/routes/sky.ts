import { Router, type IRouter } from "express";
import {
  db,
  usersTable,
  labelsTable,
  notesTable,
  starsTable,
  connectionsTable,
  constellationsTable,
} from "@workspace/db";
import { and, asc, count, desc, eq, gte, ilike, inArray, min, max, sql } from "drizzle-orm";
import {
  ExportJsonResponse,
  GetSkyResponse,
  GetSkyStatsResponse,
  GetOnThisDayQueryParams,
  GetOnThisDayResponse,
  SearchSkyQueryParams,
  SearchSkyResponse,
  UpdatePreferencesBody,
  UpdatePreferencesResponse,
} from "@workspace/api-zod";
import {
  currentUserId,
  isGuestUser,
  requireAuth,
} from "../middlewares/requireAuth";
import {
  loadConnections,
  loadConstellations,
  loadLabels,
  loadStars,
  loadTasks,
} from "../lib/sky";

const router: IRouter = Router();

router.get("/sky", requireAuth, async (req, res) => {
  const userId = currentUserId(req);
  const [labels, stars, connections, constellations, tasks, theme] = await Promise.all([
    loadLabels(userId),
    loadStars(userId),
    loadConnections(userId),
    loadConstellations(userId),
    loadTasks(userId),
    loadSkyTheme(userId),
  ]);
  res.json(
    GetSkyResponse.parse({
      isDemo: isGuestUser(userId),
      skyTheme: theme,
      labels,
      stars,
      connections,
      constellations,
      tasks,
    }),
  );
});

const SKY_THEMES = ["black", "milky-way", "nebula", "midnight", "aurora"] as const;
type SkyTheme = (typeof SKY_THEMES)[number];

async function loadSkyTheme(userId: string): Promise<SkyTheme> {
  const [row] = await db
    .select({ skyTheme: usersTable.skyTheme })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  const t = row?.skyTheme;
  return SKY_THEMES.includes(t as SkyTheme) ? (t as SkyTheme) : "black";
}

router.patch("/preferences", requireAuth, async (req, res) => {
  const userId = currentUserId(req);
  const body = UpdatePreferencesBody.parse(req.body);
  if (body.skyTheme !== undefined) {
    // Stored as-is; "black" is kept explicitly so a later default change doesn't override a choice.
    await db
      .update(usersTable)
      .set({ skyTheme: body.skyTheme })
      .where(eq(usersTable.id, userId));
  }
  res.json(UpdatePreferencesResponse.parse({ skyTheme: await loadSkyTheme(userId) }));
});

router.get("/sky/stats", requireAuth, async (req, res) => {
  const userId = currentUserId(req);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [starAgg, noteAgg, weekAgg, labelAgg, connAgg, constAgg] =
    await Promise.all([
      db
        .select({ n: count(), first: min(starsTable.createdAt) })
        .from(starsTable)
        .where(eq(starsTable.userId, userId)),
      db
        .select({ n: count(), last: max(notesTable.createdAt) })
        .from(notesTable)
        .where(eq(notesTable.userId, userId)),
      db
        .select({ n: count() })
        .from(notesTable)
        .where(
          and(eq(notesTable.userId, userId), gte(notesTable.createdAt, weekAgo)),
        ),
      db
        .select({ n: count() })
        .from(labelsTable)
        .where(eq(labelsTable.userId, userId)),
      db
        .select({ n: count() })
        .from(connectionsTable)
        .where(eq(connectionsTable.userId, userId)),
      db
        .select({ n: count() })
        .from(constellationsTable)
        .where(eq(constellationsTable.userId, userId)),
    ]);

  res.json(
    GetSkyStatsResponse.parse({
      starCount: starAgg[0]?.n ?? 0,
      noteCount: noteAgg[0]?.n ?? 0,
      labelCount: labelAgg[0]?.n ?? 0,
      connectionCount: connAgg[0]?.n ?? 0,
      constellationCount: constAgg[0]?.n ?? 0,
      notesThisWeek: weekAgg[0]?.n ?? 0,
      firstStarAt: starAgg[0]?.first ?? null,
      lastNoteAt: noteAgg[0]?.last ?? null,
    }),
  );
});

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Note body with the light formatting markers (bold, italic, bullets) removed. */
export function plainText(text: string) {
  return text
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1");
}

function snippetAround(text: string, query: string, radius = 60) {
  const flat = plainText(text).replace(/\s+/g, " ").trim();
  const i = flat.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0) return flat.slice(0, radius * 2);
  const start = Math.max(0, i - radius);
  const end = Math.min(flat.length, i + query.length + radius);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}

router.get("/search", requireAuth, async (req, res) => {
  const userId = currentUserId(req);
  const { q } = SearchSkyQueryParams.parse(req.query);
  const query = q.trim();
  if (!query) {
    res.json([]);
    return;
  }
  const pattern = `%${escapeLike(query)}%`;

  const [titleHits, noteHits] = await Promise.all([
    db
      .select({ id: starsTable.id, title: starsTable.title })
      .from(starsTable)
      .where(and(eq(starsTable.userId, userId), ilike(starsTable.title, pattern)))
      .orderBy(asc(starsTable.title))
      .limit(50),
    db
      .select({
        starId: notesTable.starId,
        body: notesTable.body,
        title: starsTable.title,
      })
      .from(notesTable)
      .innerJoin(starsTable, eq(starsTable.id, notesTable.starId))
      .where(and(eq(notesTable.userId, userId), ilike(notesTable.body, pattern)))
      .orderBy(desc(notesTable.createdAt))
      .limit(200),
  ]);

  const results = new Map<
    number,
    { starId: number; title: string; matchedIn: "title" | "note"; snippet: string }
  >();
  for (const s of titleHits) {
    results.set(s.id, {
      starId: s.id,
      title: s.title,
      matchedIn: "title",
      snippet: s.title,
    });
  }
  for (const n of noteHits) {
    if (results.has(n.starId)) continue;
    results.set(n.starId, {
      starId: n.starId,
      title: n.title,
      matchedIn: "note",
      snippet: snippetAround(n.body, query),
    });
  }

  res.json(SearchSkyResponse.parse([...results.values()].slice(0, 50)));
});

function isValidTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

router.get("/on-this-day", requireAuth, async (req, res) => {
  const userId = currentUserId(req);
  const { tz } = GetOnThisDayQueryParams.parse(req.query);
  if (!isValidTimeZone(tz)) {
    res.status(400).json({ error: "Unknown time zone" });
    return;
  }
  // Today's date in the viewer's zone, as YYYY-MM-DD.
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const day = Number(today.slice(8, 10));
  const local = sql`(${notesTable.createdAt} at time zone ${tz})`;

  const rows = await db
    .select({
      noteId: notesTable.id,
      starId: notesTable.starId,
      starTitle: starsTable.title,
      body: notesTable.body,
      createdAt: notesTable.createdAt,
    })
    .from(notesTable)
    .innerJoin(starsTable, eq(starsTable.id, notesTable.starId))
    .where(
      and(
        eq(notesTable.userId, userId),
        sql`extract(day from ${local}) = ${day}`,
        sql`${local}::date < ${today}::date`,
      ),
    )
    .orderBy(desc(notesTable.createdAt))
    .limit(20);

  res.json(
    GetOnThisDayResponse.parse(
      rows.map((r) => {
        const flat = plainText(r.body).replace(/\s+/g, " ").trim();
        return {
          noteId: r.noteId,
          starId: r.starId,
          starTitle: r.starTitle,
          snippet: flat.length > 140 ? `${flat.slice(0, 139)}…` : flat,
          createdAt: r.createdAt.toISOString(),
        };
      }),
    ),
  );
});

async function buildExport(userId: string) {
  const [labels, stars, connections, constellations, tasks] = await Promise.all([
    loadLabels(userId),
    loadStars(userId),
    loadConnections(userId),
    loadConstellations(userId),
    loadTasks(userId),
  ]);
  const starIds = stars.map((s) => s.id);
  const notes = starIds.length
    ? await db
        .select()
        .from(notesTable)
        .where(
          and(eq(notesTable.userId, userId), inArray(notesTable.starId, starIds)),
        )
        .orderBy(asc(notesTable.createdAt), asc(notesTable.id))
    : [];

  const labelName = new Map(labels.map((l) => [l.id, l.name]));
  const notesByStar = new Map<number, typeof notes>();
  for (const n of notes) {
    const list = notesByStar.get(n.starId) ?? [];
    list.push(n);
    notesByStar.set(n.starId, list);
  }

  return {
    exportedAt: new Date(),
    labels,
    stars: stars.map((s) => ({
      id: s.id,
      title: s.title,
      label: s.labelId != null ? (labelName.get(s.labelId) ?? null) : null,
      x: s.x,
      y: s.y,
      createdAt: s.createdAt,
      notes: (notesByStar.get(s.id) ?? []).map((n) => ({
        body: n.body,
        createdAt: n.createdAt,
        editedAt: n.editedAt,
      })),
    })),
    connections,
    constellations,
  };
}

function fileStamp() {
  return new Date().toISOString().slice(0, 10);
}

function fmt(d: Date) {
  return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

router.get("/export/json", requireAuth, async (req, res) => {
  const data = ExportJsonResponse.parse(await buildExport(currentUserId(req)));
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="starlog-${fileStamp()}.json"`,
  );
  res.type("application/json").send(JSON.stringify(data, null, 2));
});

router.get("/export/markdown", requireAuth, async (req, res) => {
  const data = await buildExport(currentUserId(req));
  const starTitle = new Map(data.stars.map((s) => [s.id, s.title]));

  const lines: string[] = [
    "# Starlog",
    "",
    `_Exported ${fmt(data.exportedAt)} · ${data.stars.length} stars_`,
    "",
  ];

  if (data.constellations.length) {
    lines.push("## Constellations", "");
    for (const c of data.constellations) {
      lines.push(`- **${c.name}** (around "${starTitle.get(c.anchorStarId) ?? "?"}")`);
    }
    lines.push("");
  }

  if (data.connections.length) {
    lines.push("## Connections", "");
    for (const c of data.connections) {
      lines.push(
        `- ${starTitle.get(c.fromStarId) ?? "?"} — ${starTitle.get(c.toStarId) ?? "?"}`,
      );
    }
    lines.push("");
  }

  lines.push("## Stars", "");
  for (const s of data.stars) {
    lines.push(`### ${s.title}`, "");
    const meta = [`Created ${fmt(s.createdAt)}`];
    if (s.label) meta.push(`Label: ${s.label}`);
    lines.push(`_${meta.join(" · ")}_`, "");
    if (!s.notes.length) {
      lines.push("_No notes yet._", "");
      continue;
    }
    for (const n of s.notes) {
      const edited = n.editedAt ? ` (edited ${fmt(n.editedAt)})` : "";
      lines.push(`**${fmt(n.createdAt)}**${edited}`, "", n.body, "");
    }
  }

  res.setHeader(
    "Content-Disposition",
    `attachment; filename="starlog-${fileStamp()}.md"`,
  );
  res.type("text/markdown; charset=utf-8").send(lines.join("\n"));
});

export default router;
