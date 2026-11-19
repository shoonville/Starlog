import { addDays, addMonths, differenceInCalendarDays, format, parseISO } from "date-fns";
import type { Label, Star, Task, TaskPriority, TaskRepeat } from "@workspace/api-client-react";

/** Today's calendar day in the viewer's own time zone, as YYYY-MM-DD. */
export function todayStr(now = new Date()) {
  return format(now, "yyyy-MM-dd");
}

export const isOverdue = (t: Task, today = todayStr()) => !t.done && t.dueDate != null && t.dueDate < today;
export const isDueToday = (t: Task, today = todayStr()) => !t.done && t.dueDate === today;

const PRIORITY_RANK: Record<TaskPriority, number> = { high: 0, normal: 1, low: 2 };

/** Automatic order: overdue first, then by date (undated last), then by priority. */
export function autoSort(tasks: Task[]) {
  return [...tasks].sort((a, b) => {
    if (a.dueDate !== b.dueDate) {
      if (a.dueDate == null) return 1;
      if (b.dueDate == null) return -1;
      return a.dueDate < b.dueDate ? -1 : 1;
    }
    const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (p) return p;
    return a.position - b.position || a.id - b.id;
  });
}

export function orderedOpenTasks(tasks: Task[], mode: Star["taskOrder"]) {
  const open = tasks.filter((t) => !t.done);
  return mode === "manual" ? [...open].sort((a, b) => a.position - b.position || a.id - b.id) : autoSort(open);
}

/** Short due label: Today, Tomorrow, Yesterday, a weekday within the week, or "Nov 28". */
export function formatDue(day: string, today = todayStr()) {
  const d = parseISO(day);
  const diff = differenceInCalendarDays(d, parseISO(today));
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff > 1 && diff < 7) return format(d, "EEEE");
  return format(d, d.getFullYear() === parseISO(today).getFullYear() ? "MMM d" : "MMM d, yyyy");
}

export const REPEAT_LABEL: Record<NonNullable<TaskRepeat>, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" };

/* ---------------- Quick add parsing ---------------- */

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WEEKDAY_SHORT = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export type ParsedTask = {
  title: string;
  dueDate: string | null;
  priority: TaskPriority;
  repeat: TaskRepeat;
  /** Text after "#", if any. */
  tag: string | null;
};

/**
 * Pulls a date, repeat, priority and #tag out of a one-line task, e.g.
 * "Call dentist Friday #Personal" → title "Call dentist", Friday, tag "Personal".
 */
export function parseQuickAdd(input: string, now = new Date()): ParsedTask {
  let text = ` ${input.trim()} `;
  let dueDate: string | null = null;
  let repeat: TaskRepeat = null;
  let priority: TaskPriority = "normal";
  let tag: string | null = null;
  // Removes the first match that `fn` accepts; a rejected match lets the search go on further along.
  const take = (re: RegExp, fn: (m: RegExpExecArray) => boolean | void) => {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    for (let m = g.exec(text); m; m = g.exec(text)) {
      if (fn(m) !== false) {
        text = `${text.slice(0, m.index)} ${text.slice(m.index + m[0].length)}`;
        return;
      }
      g.lastIndex = m.index + 1;
    }
  };
  const day = (d: Date) => format(d, "yyyy-MM-dd");

  take(/\s#([^\s#]+)/u, (m) => { tag = m[1]!.replace(/[_-]+/g, " ").trim(); });
  take(/\s(?:!high|!!|!h)(?=\s)/i, () => { priority = "high"; });
  take(/\s(?:!low|!l)(?=\s)/i, () => { priority = "low"; });
  take(/\s(?:every\s+day|daily)(?=\s)/i, () => { repeat = "daily"; });
  take(/\s(?:every\s+week|weekly)(?=\s)/i, () => { repeat = "weekly"; });
  take(/\s(?:every\s+month|monthly)(?=\s)/i, () => { repeat = "monthly"; });
  // Words that may lead into a date ("on Friday", "by tomorrow", "due this Friday").
  const P = "(?:(?:on|by|due|before)\\s+)?";
  take(new RegExp(`\\s${P}(\\d{4}-\\d{2}-\\d{2})(?=\\s)`), (m) => { dueDate = m[1]!; });
  if (!dueDate) take(new RegExp(`\\s${P}(?:today|tonight|this\\s+(?:morning|afternoon|evening))(?=\\s)`, "i"), () => { dueDate = day(now); });
  if (!dueDate) take(new RegExp(`\\s${P}(?:tomorrow|tmrw?)(?:\\s+(?:morning|afternoon|evening|night))?(?=\\s)`, "i"), () => { dueDate = day(addDays(now, 1)); });
  if (!dueDate) take(/\sin\s+(\d{1,3})\s+days?(?=\s)/i, (m) => { dueDate = day(addDays(now, Number(m[1]))); });
  if (!dueDate) take(/\sin\s+(\d{1,2})\s+weeks?(?=\s)/i, (m) => { dueDate = day(addDays(now, 7 * Number(m[1]))); });
  if (!dueDate) take(/\sin\s+a\s+week(?=\s)/i, () => { dueDate = day(addDays(now, 7)); });
  if (!dueDate) take(/\snext\s+week(?=\s)/i, () => { dueDate = day(addDays(now, 7)); });
  if (!dueDate) take(/\s(?:next\s+month|in\s+a\s+month)(?=\s)/i, () => { dueDate = day(addMonths(now, 1)); });
  if (!dueDate) {
    take(new RegExp(`\\s${P}(this\\s+|next\\s+)?weekend(?=\\s)`, "i"), (m) => {
      let diff = (6 - now.getDay() + 7) % 7;
      if (now.getDay() === 0) diff = 0; // it's already the weekend
      if (m[1]?.toLowerCase().startsWith("next")) diff += 7;
      dueDate = day(addDays(now, diff));
    });
  }
  if (!dueDate) {
    take(new RegExp(`\\s${P}(next\\s+|this\\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|tues?|thu(?:rs?)?|fri)(?=\\s)`, "i"), (m) => {
      const w = m[2]!.toLowerCase().slice(0, 3);
      const idx = WEEKDAY_SHORT.indexOf(w);
      if (idx < 0) return false;
      let diff = (idx - now.getDay() + 7) % 7;
      if (m[1]?.toLowerCase().startsWith("next") && diff === 0) diff = 7;
      dueDate = day(addDays(now, diff));
      return true;
    });
  }
  if (!dueDate) {
    take(new RegExp(`\\s${P}(?:(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?([a-z]{3,9})|([a-z]{3,9})\\s+(\\d{1,2})(?:st|nd|rd|th)?)(?=\\s)`, "i"), (m) => {
      const mon = (m[2] ?? m[3]!).toLowerCase().slice(0, 3);
      const mi = MONTHS.indexOf(mon);
      const dd = Number(m[1] ?? m[4]);
      if (mi < 0 || dd < 1 || dd > 31) return false;
      let d = new Date(now.getFullYear(), mi, dd);
      if (d.getMonth() !== mi) return false;
      if (differenceInCalendarDays(d, now) < -14) d = new Date(now.getFullYear() + 1, mi, dd);
      dueDate = day(d);
      return true;
    });
  }
  if (!dueDate) {
    // "by the 1st", "on the 15th": the next time that day of the month comes round.
    take(new RegExp(`\\s${P}(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)(?=\\s)`, "i"), (m) => {
      const dd = Number(m[1]);
      if (dd < 1 || dd > 31) return false;
      for (let k = 0; k < 3; k++) {
        const d = new Date(now.getFullYear(), now.getMonth() + k, dd);
        if (d.getDate() === dd && differenceInCalendarDays(d, now) >= 0) { dueDate = day(d); return true; }
      }
      return false;
    });
  }
  const title = text.replace(/\s+/g, " ").trim();
  return { title, dueDate, priority, repeat, tag };
}

export const weekdayName = (d: string) => WEEKDAYS[parseISO(d).getDay()];

const norm = (s: string) => s.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

export type TaskDestination =
  | { kind: "star"; star: Star; via: "title" | "label"; label?: Label }
  | { kind: "inbox"; star: Star | null };

export const INBOX_TITLE = "Inbox";
export const DAILY_LOG_TITLE = "Daily log";

export function findStarByTitle(stars: Star[], title: string) {
  const n = norm(title);
  return stars.find((s) => norm(s.title) === n) ?? null;
}

/** Where a quick-added task goes: a star whose title matches the tag, else the latest star with that label, else Inbox. */
export function resolveDestination(tag: string | null, stars: Star[], labels: Label[]): TaskDestination {
  const inbox = findStarByTitle(stars, INBOX_TITLE);
  if (!tag) return { kind: "inbox", star: inbox };
  const n = norm(tag);
  if (!n) return { kind: "inbox", star: inbox };
  const exact = stars.find((s) => norm(s.title) === n);
  if (exact) return { kind: "star", star: exact, via: "title" };
  const label = labels.find((l) => norm(l.name) === n);
  if (label) {
    const latest = stars
      .filter((s) => s.labelId === label.id)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
    if (latest) return { kind: "star", star: latest, via: "label", label };
  }
  const prefix = stars.find((s) => norm(s.title).startsWith(n));
  if (prefix && n.length >= 3) return { kind: "star", star: prefix, via: "title" };
  return { kind: "inbox", star: inbox };
}
