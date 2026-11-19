import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { differenceInCalendarMonths, differenceInCalendarYears, format, formatDistanceToNowStrict } from "date-fns";
import {
  getGetSkyQueryKey,
  getGetSkyStatsQueryKey,
  getListLabelsQueryKey,
  useAddStressStars,
  useGetOnThisDay,
  useRemoveStressStars,
  type Label,
  type OnThisDayNote,
  type Star,
} from "@workspace/api-client-react";
import { X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DEFAULT_STAR } from "@/lib/sky";
import { UNDO_MS, undoDelete, usePendingDeletes } from "@/lib/pending-deletes";

/* ---------------- Recent stars ---------------- */

export function RecentPanel({
  stars,
  labels,
  selectedId,
  onPick,
  onClose,
}: {
  stars: Star[];
  labels: Label[];
  selectedId: number | null;
  onPick: (id: number) => void;
  onClose: () => void;
}) {
  const colorOf = useMemo(() => new Map(labels.map((l) => [l.id, l.color])), [labels]);
  const sorted = useMemo(
    () => [...stars].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || b.id - a.id).slice(0, 150),
    [stars],
  );
  // Re-render each minute so "5m ago" stays honest.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="sky-glass flex max-h-full flex-col overflow-hidden rounded-[20px]" data-testid="panel-recent">
      <div className="flex items-center justify-between px-4 pb-2 pt-3.5">
        <span className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground/80">Recently written</span>
        <button onClick={onClose} aria-label="Close recent list" className="rounded-full p-1 text-muted-foreground/70 hover:bg-white/5 hover:text-foreground" data-testid="button-close-recent">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {sorted.length === 0 ? (
        <p className="px-4 pb-4 text-[12.5px] text-muted-foreground/80">No stars yet.</p>
      ) : (
        <ul className="thin-scroll min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
          {sorted.map((s) => {
            const color = s.labelId != null ? colorOf.get(s.labelId) ?? DEFAULT_STAR : DEFAULT_STAR;
            const active = s.id === selectedId;
            return (
              <li key={s.id}>
                <button
                  onClick={() => onPick(s.id)}
                  className={`group flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors duration-300 ${active ? "bg-white/[0.08]" : "hover:bg-white/[0.05]"}`}
                  data-testid={`button-recent-${s.id}`}
                >
                  <span className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-[13px] ${active ? "text-foreground" : "text-foreground/85 group-hover:text-foreground"}`}>{s.title}</span>
                    <span className="block text-[11px] text-muted-foreground/70">
                      {formatDistanceToNowStrict(new Date(s.updatedAt), { addSuffix: true })} · {s.noteCount} {s.noteCount === 1 ? "note" : "notes"}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ---------------- On this day ---------------- */

function agoLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const years = differenceInCalendarYears(now, d);
  if (years >= 1 && d.getMonth() === now.getMonth()) return years === 1 ? "1 year ago" : `${years} years ago`;
  const months = differenceInCalendarMonths(now, d);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}

export function OnThisDay({ hiddenNoteIds, onOpen }: { hiddenNoteIds: Set<number>; onOpen: (n: OnThisDayNote) => void }) {
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  // Re-check when the date rolls over.
  const [day, setDay] = useState(() => new Date().toDateString());
  useEffect(() => {
    const t = window.setInterval(() => setDay(new Date().toDateString()), 60_000);
    return () => clearInterval(t);
  }, []);
  const q = useGetOnThisDay({ tz }, { query: { queryKey: ["on-this-day", tz, day], staleTime: 5 * 60_000 } });
  const notes = (q.data ?? []).filter((n) => !hiddenNoteIds.has(n.noteId));
  const [open, setOpen] = useState(false);
  if (!notes.length) return null;

  const button = (
    <button
      onClick={notes.length === 1 ? () => onOpen(notes[0]!) : undefined}
      title={notes.length === 1 ? `${agoLabel(notes[0]!.createdAt)} · ${notes[0]!.starTitle}` : undefined}
      className="sky-pill day-glow rise flex items-center gap-2 rounded-full py-1.5 pl-3 pr-3.5 text-[12px] text-foreground/90 transition-colors hover:text-foreground"
      data-testid="button-on-this-day"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-[#f4e4c4] shadow-[0_0_10px_2px_rgba(244,228,196,0.6)] breathe" />
      On this day
    </button>
  );
  if (notes.length === 1) return button;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{button}</PopoverTrigger>
      <PopoverContent side="bottom" align="end" className="sky-glass mt-2 w-80 rounded-2xl border-0 p-2">
        <div className="px-2.5 pb-1.5 pt-1.5 text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground/70">
          Written on {format(new Date(), "MMMM d")}
        </div>
        <ul className="thin-scroll max-h-80 overflow-y-auto">
          {notes.map((n) => (
            <li key={n.noteId}>
              <button
                onClick={() => { setOpen(false); onOpen(n); }}
                className="w-full rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-white/[0.05]"
                data-testid={`button-on-this-day-${n.noteId}`}
              >
                <span className="block text-[11px] text-muted-foreground/75">{agoLabel(n.createdAt)} · {n.starTitle}</span>
                <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-snug text-foreground/85">{n.snippet}</span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/* ---------------- Undo bar ---------------- */

export function UndoBar() {
  const pending = usePendingDeletes();
  const latest = pending[pending.length - 1];
  if (!latest) return null;
  const remaining = Math.max(0, UNDO_MS - (Date.now() - latest.startedAt));
  const kind = latest.kind === "star" ? "Star" : "Note";
  return (
    <div key={latest.key} className="rise sky-pill relative flex items-center gap-3 overflow-hidden whitespace-nowrap rounded-full py-1.5 pl-4 pr-1.5 text-[12.5px] text-foreground/90" role="status" data-testid="bar-undo">
      <span className="max-w-[56vw] truncate">
        {latest.kind === "star" ? <>"{latest.label}" let go</> : <>{kind} deleted</>}
        {pending.length > 1 && <span className="text-muted-foreground"> (+{pending.length - 1})</span>}
      </span>
      <button onClick={() => undoDelete(latest.key)} className="rounded-full bg-primary px-3 py-1 font-medium text-primary-foreground transition-all hover:brightness-105" data-testid="button-undo">
        Undo
      </button>
      <span className="undo-drain absolute bottom-0 left-0 h-[2px] w-full bg-primary/50" style={{ animationDuration: `${remaining}ms` }} />
    </div>
  );
}

/* ---------------- Developer tools (hidden) ---------------- */

function useFps() {
  const [stats, setStats] = useState({ fps: 0, worst: 0 });
  useEffect(() => {
    let raf = 0;
    let frames = 0;
    let worst = 0;
    let windowStart = performance.now();
    let prev = windowStart;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      frames++;
      worst = Math.max(worst, now - prev);
      prev = now;
      if (now - windowStart >= 1000) {
        setStats({ fps: Math.round((frames * 1000) / (now - windowStart)), worst: Math.round(worst) });
        frames = 0;
        worst = 0;
        windowStart = now;
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return stats;
}

export function DevPanel({ starCount, onClose }: { starCount: number; onClose: () => void }) {
  const qc = useQueryClient();
  const add = useAddStressStars();
  const remove = useRemoveStressStars();
  const { fps, worst } = useFps();
  const [msg, setMsg] = useState<string | null>(null);
  const msgTimer = useRef(0);
  const say = (m: string) => {
    setMsg(m);
    clearTimeout(msgTimer.current);
    msgTimer.current = window.setTimeout(() => setMsg(null), 3000);
  };
  const refresh = () => {
    qc.invalidateQueries({ queryKey: getGetSkyQueryKey() });
    qc.invalidateQueries({ queryKey: getGetSkyStatsQueryKey() });
    qc.invalidateQueries({ queryKey: getListLabelsQueryKey() });
  };
  const busy = add.isPending || remove.isPending;
  const fpsColor = fps >= 55 ? "text-[hsl(150_35%_74%)]" : fps >= 40 ? "text-[hsl(40_70%_76%)]" : "text-[hsl(350_62%_76%)]";

  return (
    <div className="sky-glass w-60 rounded-2xl p-4 text-[12px]" data-testid="panel-dev">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground/80">Developer</span>
        <button onClick={onClose} aria-label="Close developer tools" className="rounded-full p-1 text-muted-foreground/70 hover:bg-white/5 hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mb-3 grid grid-cols-3 gap-2 text-center">
        <div><div className={`text-[18px] font-light tabular-nums ${fpsColor}`} data-testid="text-fps">{fps}</div><div className="text-[10px] text-muted-foreground/70">fps</div></div>
        <div><div className="text-[18px] font-light tabular-nums">{worst}</div><div className="text-[10px] text-muted-foreground/70">worst ms</div></div>
        <div><div className="text-[18px] font-light tabular-nums">{starCount}</div><div className="text-[10px] text-muted-foreground/70">stars</div></div>
      </div>
      <div className="flex flex-col gap-1.5">
        <button
          disabled={busy}
          onClick={() => add.mutate({ data: { count: 300 } }, {
            onSuccess: (r) => { refresh(); say(`Added ${r.count} test stars`); },
            onError: () => say("Couldn't add test stars"),
          })}
          className="rounded-full bg-primary py-1.5 font-medium text-primary-foreground disabled:opacity-50"
          data-testid="button-stress-add"
        >
          {add.isPending ? "Adding..." : "Add 300 random stars"}
        </button>
        <button
          disabled={busy}
          onClick={() => remove.mutate(undefined, {
            onSuccess: (r) => { refresh(); say(r.count ? `Removed ${r.count} test stars` : "No test stars to remove"); },
            onError: () => say("Couldn't remove test stars"),
          })}
          className="rounded-full border border-white/10 py-1.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
          data-testid="button-stress-remove"
        >
          {remove.isPending ? "Removing..." : "Remove test stars"}
        </button>
      </div>
      <p className="mt-2.5 min-h-[1.2em] text-[11px] text-muted-foreground/70">{msg ?? "Shift + D hides this panel"}</p>
    </div>
  );
}
