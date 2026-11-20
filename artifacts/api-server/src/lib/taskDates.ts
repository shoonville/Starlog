export type Repeat = "daily" | "weekly" | "monthly";

const pad = (n: number) => String(n).padStart(2, "0");
const fmt = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parse = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
};

/** Adds one repeat step to a calendar day. Monthly keeps the day, clamped to the month's end. */
function step(day: Date, repeat: Repeat, anchorDay: number) {
  if (repeat === "daily") return new Date(day.getTime() + 86_400_000);
  if (repeat === "weekly") return new Date(day.getTime() + 7 * 86_400_000);
  const y = day.getUTCFullYear(), m = day.getUTCMonth() + 1;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(anchorDay, last)));
}

/**
 * Due date for the next instance of a repeating task: one step after the current due
 * date, moved forward until it lands after today (so a long-overdue daily task comes
 * back tomorrow, not in the past).
 */
export function nextDueDate(due: string | null, repeat: Repeat, today?: string, anchorDay?: number) {
  const todayStr = today ?? fmt(new Date());
  const start = parse(due ?? todayStr);
  const anchor = anchorDay ?? start.getUTCDate();
  let next = step(start, repeat, anchor);
  const t = parse(todayStr).getTime();
  for (let i = 0; i < 1000 && next.getTime() <= t; i++) next = step(next, repeat, anchor);
  return fmt(next);
}
