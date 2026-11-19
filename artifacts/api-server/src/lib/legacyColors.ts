import { db, labelsTable } from "@workspace/db";
import { inArray, sql } from "drizzle-orm";
import { logger } from "./logger";

/**
 * The label palette moved from soft pastels to richer colors. Labels still using
 * an old pastel are switched to its vivid counterpart once, at startup.
 */
const LEGACY_TO_VIVID: Record<string, string> = {
  "#9DB8E8": "#4D8DFF",
  "#8FB3E8": "#4D8DFF",
  "#B9A6F0": "#A06BFF",
  "#B9A6E8": "#A06BFF",
  "#EBA9C0": "#FF5C9E",
  "#E8A6BC": "#FF5C9E",
  "#EBC98A": "#FFC23D",
  "#E8CF8F": "#FFC23D",
  "#A9CDB0": "#34D399",
  "#F0B49A": "#FF8A4C",
  "#8FCFCB": "#22D3D3",
  "#D7B4E8": "#E36BFF",
  "#E4DFF0": "#D6DEFF",
};

export async function upgradeLegacyLabelColors() {
  const legacy = Object.keys(LEGACY_TO_VIVID);
  const cases = sql.join(
    legacy.map((old) => sql`when upper(${labelsTable.color}) = ${old} then ${LEGACY_TO_VIVID[old]}`),
    sql` `,
  );
  try {
    const rows = await db
      .update(labelsTable)
      .set({ color: sql`case ${cases} else ${labelsTable.color} end` })
      .where(inArray(sql`upper(${labelsTable.color})`, legacy))
      .returning({ id: labelsTable.id });
    if (rows.length) logger.info({ count: rows.length }, "Upgraded legacy label colors");
  } catch (err) {
    logger.error({ err }, "Could not upgrade legacy label colors");
  }
}
