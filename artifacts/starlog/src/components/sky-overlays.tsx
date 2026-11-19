import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import {
  getGetSkyStatsQueryKey,
  getSearchSkyQueryKey,
  useGetSkyStats,
  useSearchSky,
  type Label,
  type SearchResult,
  type Star,
} from "@workspace/api-client-react";
import { Pause, Pencil, Play, Plus, Search, Trash2, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PALETTE, brighten, hexToRgb } from "@/lib/sky";
import type { SkyActions } from "@/hooks/use-sky-actions";

/* ---------------- Legend ---------------- */

function LabelEditor({ label, actions, onDone }: { label: Label; actions: SkyActions; onDone: () => void }) {
  const [name, setName] = useState(label.name);
  return (
    <div className="space-y-3">
      <input
        autoFocus
        value={name}
        maxLength={40}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name.trim() !== label.name && actions.editLabel(label.id, { name: name.trim() })}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className="quiet-input w-full border-b border-white/10 pb-1.5 text-[13px]"
        data-testid={`input-label-name-${label.id}`}
      />
      <div className="flex flex-wrap gap-1.5">
        {PALETTE.map((p) => (
          <button
            key={p.hex}
            title={p.name}
            onClick={() => actions.editLabel(label.id, { color: p.hex })}
            className={`h-5 w-5 rounded-full transition-transform duration-300 soft-ease ${label.color.toLowerCase() === p.hex.toLowerCase() ? "scale-110 ring-2 ring-white/50 ring-offset-2 ring-offset-[#111114]" : "hover:scale-110"}`}
            style={{ background: p.hex }}
          />
        ))}
      </div>
      <div className="flex items-center justify-between pt-1 text-[12px]">
        <button
          onClick={() => { actions.removeLabel(label.id); onDone(); }}
          className="flex items-center gap-1 text-muted-foreground hover:text-[hsl(350_62%_74%)]"
          data-testid={`button-delete-label-${label.id}`}
        >
          <Trash2 className="h-3 w-3" /> Delete label
        </button>
        <button onClick={onDone} className="text-muted-foreground hover:text-foreground">Done</button>
      </div>
    </div>
  );
}

export function Legend({
  labels,
  active,
  onToggle,
  actions,
  dimmed,
}: {
  labels: Label[];
  active: number | null;
  onToggle: (id: number) => void;
  actions: SkyActions;
  dimmed: boolean;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(PALETTE[0].hex);
  return (
    <div className={`sky-pill rounded-2xl px-2 py-2 transition-opacity duration-700 soft-ease ${dimmed ? "opacity-30 hover:opacity-100" : "opacity-100"}`} data-testid="legend">
      <ul className="flex flex-col">
        {labels.map((l) => (
          <li key={l.id} className="group flex items-center">
            <button
              onClick={() => onToggle(l.id)}
              className={`flex flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[12.5px] transition-all duration-500 soft-ease ${active === l.id ? "bg-white/10 text-foreground" : active != null ? "text-foreground/45 hover:text-foreground/80" : "text-foreground/[0.82] hover:text-foreground"}`}
              data-testid={`button-legend-${l.id}`}
            >
              <span className="h-2 w-2 shrink-0 rounded-full transition-colors duration-700" style={{ background: brighten(l.color), boxShadow: `0 0 8px rgba(${hexToRgb(l.color).join(",")},0.7), 0 0 2px ${brighten(l.color)}` }} />
              <span className="max-w-[9rem] truncate">{l.name}</span>
              <span className="ml-auto pl-3 text-[11px] tabular-nums opacity-[0.62]">{l.starCount}</span>
            </button>
            <Popover open={editing === l.id} onOpenChange={(o) => setEditing(o ? l.id : null)}>
              <PopoverTrigger asChild>
                <button className="rounded-md p-1 text-muted-foreground/60 opacity-0 transition-opacity duration-300 hover:text-foreground group-hover:opacity-100 focus:opacity-100" aria-label={`Edit ${l.name}`} data-testid={`button-edit-label-${l.id}`}>
                  <Pencil className="h-3 w-3" />
                </button>
              </PopoverTrigger>
              <PopoverContent side="right" align="end" className="sky-glass w-60 rounded-2xl border-0 p-4">
                <LabelEditor label={l} actions={actions} onDone={() => setEditing(null)} />
              </PopoverContent>
            </Popover>
          </li>
        ))}
      </ul>
      <Popover open={creating} onOpenChange={setCreating}>
        <PopoverTrigger asChild>
          <button className="mt-0.5 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] text-muted-foreground/70 transition-colors hover:text-foreground" data-testid="button-new-label">
            <Plus className="h-3 w-3" /> {labels.length ? "New label" : "Add a label"}
          </button>
        </PopoverTrigger>
        <PopoverContent side="right" align="end" className="sky-glass w-60 rounded-2xl border-0 p-4">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              actions.addLabel(name.trim(), color);
              setName("");
              setCreating(false);
            }}
          >
            <input autoFocus value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Label name" className="quiet-input w-full border-b border-white/10 pb-1.5 text-[13px]" data-testid="input-label-new" />
            <div className="flex flex-wrap gap-1.5">
              {PALETTE.map((p) => (
                <button type="button" key={p.hex} title={p.name} onClick={() => setColor(p.hex)} className={`h-5 w-5 rounded-full transition-transform duration-300 ${color === p.hex ? "scale-110 ring-2 ring-white/50 ring-offset-2 ring-offset-[#111114]" : "hover:scale-110"}`} style={{ background: p.hex }} />
              ))}
            </div>
            <button type="submit" disabled={!name.trim()} className="w-full rounded-full bg-primary py-1.5 text-[12.5px] font-medium text-primary-foreground disabled:opacity-30" data-testid="button-create-label">
              Create label
            </button>
          </form>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/* ---------------- Search ---------------- */

export function SearchPanel({
  onResults,
  onPick,
  onClose,
}: {
  onResults: (ids: Set<number> | null) => void;
  onPick: (id: number) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setDq(q.trim()), 220);
    return () => clearTimeout(t);
  }, [q]);
  const res = useSearchSky({ q: dq }, { query: { enabled: dq.length > 0, queryKey: getSearchSkyQueryKey({ q: dq }) } });
  const results: SearchResult[] = dq ? res.data ?? [] : [];
  const ids = useMemo(() => (dq && res.data ? new Set(res.data.map((r) => r.starId)) : null), [dq, res.data]);
  const cb = useRef(onResults);
  cb.current = onResults;
  useEffect(() => { cb.current(ids); }, [ids]);
  useEffect(() => () => cb.current(null), []);

  return (
    <div className="sky-glass w-full overflow-hidden rounded-2xl" data-testid="panel-search">
      <div className="flex items-center gap-3 px-4 py-3">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.stopPropagation(); onClose(); }
            if (e.key === "Enter" && results[0]) onPick(results[0].starId);
          }}
          placeholder="Search titles and notes"
          className="quiet-input flex-1 text-[14.5px]"
          data-testid="input-search"
        />
        <button onClick={onClose} className="rounded-full p-1 text-muted-foreground hover:text-foreground" aria-label="Close search" data-testid="button-close-search">
          <X className="h-4 w-4" />
        </button>
      </div>
      {dq && (
        <div className="thin-scroll max-h-[46vh] overflow-y-auto border-t border-white/[0.06] p-1.5">
          {res.isLoading ? (
            <div className="space-y-2 p-3">
              <div className="h-3 w-1/2 rounded-full bg-white/[0.06] breathe" />
              <div className="h-3 w-3/4 rounded-full bg-white/[0.05] breathe" />
            </div>
          ) : results.length === 0 ? (
            <p className="px-3 py-4 text-[13px] text-muted-foreground">No star holds "{dq}" yet.</p>
          ) : (
            results.map((r, i) => (
              <button
                key={`${r.starId}-${i}`}
                onClick={() => onPick(r.starId)}
                className="block w-full rounded-xl px-3 py-2.5 text-left transition-colors duration-300 hover:bg-white/[0.06]"
                data-testid={`result-search-${r.starId}`}
              >
                <div className="flex items-center gap-2 text-[13.5px] text-foreground">
                  {r.title}
                  <span className="text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground/60">{r.matchedIn === "note" ? "in a note" : "title"}</span>
                </div>
                {r.matchedIn === "note" && <div className="mt-0.5 line-clamp-2 text-[12.5px] text-muted-foreground">{r.snippet}</div>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------- Timeline ---------------- */

export function Timeline({ stars, onCutoff, onClose }: { stars: Star[]; onCutoff: (t: number) => void; onClose: () => void }) {
  const { min, max } = useMemo(() => {
    const ts = stars.map((s) => Date.parse(s.createdAt)).sort((a, b) => a - b);
    const mn = ts[0] ?? Date.now();
    const mx = ts[ts.length - 1] ?? mn;
    return { min: mn - 1, max: Math.max(mx, mn + 1) };
  }, [stars]);
  const [p, setP] = useState(0);
  const [playing, setPlaying] = useState(true);
  const pRef = useRef(p);
  pRef.current = p;
  const cb = useRef(onCutoff);
  cb.current = onCutoff;
  const cutoff = min + p * (max - min);
  useEffect(() => { cb.current(cutoff); }, [cutoff]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let cur = pRef.current >= 1 ? 0 : pRef.current;
    const step = (now: number) => {
      const dt = now - last;
      last = now;
      cur = Math.min(1, cur + dt / 12000);
      setP(cur);
      if (cur >= 1) setPlaying(false);
      else raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const count = stars.filter((s) => Date.parse(s.createdAt) <= cutoff).length;

  return (
    <div className="sky-glass flex w-full items-center gap-4 rounded-2xl px-4 py-3" data-testid="panel-timeline">
      <button
        onClick={() => { if (p >= 1) setP(0); setPlaying(!playing || p >= 1); }}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform duration-300 hover:scale-105"
        aria-label={playing ? "Pause" : "Play"}
        data-testid="button-timeline-play"
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-baseline justify-between text-[12px]">
          <span className="font-medium text-foreground" data-testid="text-timeline-date">{format(new Date(cutoff), "MMMM d, yyyy")}</span>
          <span className="tabular-nums text-muted-foreground">{count} of {stars.length} stars</span>
        </div>
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round(p * 1000)}
          onChange={(e) => { setPlaying(false); setP(Number(e.target.value) / 1000); }}
          className="sky-range"
          data-testid="slider-timeline"
        />
      </div>
      <button onClick={onClose} className="shrink-0 rounded-full px-3 py-1.5 text-[12px] text-muted-foreground hover:bg-white/5 hover:text-foreground" data-testid="button-close-timeline">
        Back to now
      </button>
    </div>
  );
}

/* ---------------- Stats ---------------- */

export function StatsReadout() {
  const { data, isLoading } = useGetSkyStats({ query: { queryKey: getGetSkyStatsQueryKey() } });
  if (isLoading || !data)
    return <div className="grid grid-cols-3 gap-2">{[0, 1, 2].map((i) => <div key={i} className="h-10 rounded-lg bg-white/[0.05] breathe" />)}</div>;
  const rows: [string, number][] = [
    ["stars", data.starCount],
    ["notes", data.noteCount],
    ["this week", data.notesThisWeek],
    ["labels", data.labelCount],
    ["lines", data.connectionCount],
    ["named", data.constellationCount],
  ];
  return (
    <div>
      <div className="grid grid-cols-3 gap-x-3 gap-y-3">
        {rows.map(([k, v]) => (
          <div key={k} data-testid={`stat-${k.replace(" ", "-")}`}>
            <div className="text-[17px] font-medium tabular-nums text-foreground">{v}</div>
            <div className="text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground/70">{k}</div>
          </div>
        ))}
      </div>
      {data.firstStarAt && (
        <p className="mt-3 text-[11.5px] text-muted-foreground/70">
          First star {format(new Date(data.firstStarAt), "MMM d, yyyy")}
          {data.lastNoteAt ? ` · last note ${format(new Date(data.lastNoteAt), "MMM d")}` : ""}
        </p>
      )}
    </div>
  );
}
