import {
  doublePrecision,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

const userRef = () =>
  varchar("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" });

export const labelsTable = pgTable(
  "labels",
  {
    id: serial("id").primaryKey(),
    userId: userRef(),
    name: text("name").notNull(),
    color: varchar("color", { length: 7 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("labels_user_idx").on(t.userId)],
);

export const starsTable = pgTable(
  "stars",
  {
    id: serial("id").primaryKey(),
    userId: userRef(),
    title: text("title").notNull(),
    x: doublePrecision("x").notNull(),
    y: doublePrecision("y").notNull(),
    labelId: integer("label_id").references(() => labelsTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("stars_user_idx").on(t.userId)],
);

export const notesTable = pgTable(
  "notes",
  {
    id: serial("id").primaryKey(),
    userId: userRef(),
    starId: integer("star_id")
      .notNull()
      .references(() => starsTable.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
  },
  (t) => [
    index("notes_star_idx").on(t.starId),
    index("notes_user_idx").on(t.userId),
  ],
);

export const connectionsTable = pgTable(
  "connections",
  {
    id: serial("id").primaryKey(),
    userId: userRef(),
    // Stored normalized so fromStarId < toStarId; one line per pair.
    fromStarId: integer("from_star_id")
      .notNull()
      .references(() => starsTable.id, { onDelete: "cascade" }),
    toStarId: integer("to_star_id")
      .notNull()
      .references(() => starsTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("connections_user_idx").on(t.userId),
    uniqueIndex("connections_pair_idx").on(t.fromStarId, t.toStarId),
  ],
);

export const constellationsTable = pgTable(
  "constellations",
  {
    id: serial("id").primaryKey(),
    userId: userRef(),
    name: text("name").notNull(),
    anchorStarId: integer("anchor_star_id")
      .notNull()
      .references(() => starsTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("constellations_user_idx").on(t.userId)],
);

export type LabelRow = typeof labelsTable.$inferSelect;
export type StarRow = typeof starsTable.$inferSelect;
export type NoteRow = typeof notesTable.$inferSelect;
export type ConnectionRow = typeof connectionsTable.$inferSelect;
export type ConstellationRow = typeof constellationsTable.$inferSelect;
