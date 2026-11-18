import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useEndDemo, type Sky } from "@workspace/api-client-react";
import { useAuth } from "@workspace/replit-auth-web";
import { Clock, Download, History, Link2, Menu, Plus, Search, ZoomIn, ZoomOut } from "lucide-react";
import SkyCanvas, { type SkyCanvasHandle } from "@/components/sky-canvas";
import JournalCard from "@/components/journal-card";
import { Legend, SearchPanel, StatsReadout, Timeline } from "@/components/sky-overlays";
import { Wordmark } from "@/components/wordmark";
import { DevPanel, OnThisDay, RecentPanel, UndoBar } from "@/components/sky-extras";
import { undoDelete, usePendingDeletes } from "@/lib/pending-deletes";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSkyActions } from "@/hooks/use-sky-actions";
import { componentRoots, constellationViews } from "@/lib/sky";
import { toast } from "@/hooks/use-toast";

const EASE = [0.22, 1, 0.36, 1] as const;

function useNarrow() {
  const [n, setN] = useState(() => window.matchMedia("(max-width: 767px)").matches);
  useEffect(() => {
    const m = window.matchMedia("(max-width: 767px)");
    const f = () => setN(m.matches);
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return n;
}

function ToolButton({ label, kbd, active, onClick, children, testId }: { label: string; kbd?: string; active?: boolean; onClick: () => void; children: React.ReactNode; testId: string }) {
  return (
    <Tooltip delayDuration={500}>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          aria-label={label}
          className={`flex h-9 w-9 items-center justify-center rounded-full transition-all duration-500 soft-ease ${active ? "bg-primary/90 text-primary-foreground" : "text-muted-foreground hover:bg-white/[0.07] hover:text-foreground"}`}
          data-testid={testId}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="sky-pill rounded-lg border-0 px-2.5 py-1 text-[11.5px] text-foreground">
        {label}
        {kbd && <span className="ml-2 text-muted-foreground">{kbd}</span>}
      </TooltipContent>
    </Tooltip>
  );
}

/** The sky as it should look, with items that are waiting to be deleted hidden. */
function useVisibleSky(sky: Sky): Sky {
  const pending = usePendingDeletes();
  return useMemo(() => {
    if (!pending.length) return sky;
    const goneStars = new Set(pending.filter((p) => p.kind === "star").map((p) => p.id));
    const lessNotes = new Map<number, number>();
    for (const p of pending) if (p.kind === "note" && p.starId != null) lessNotes.set(p.starId, (lessNotes.get(p.starId) ?? 0) + 1);
    const stars = sky.stars
      .filter((s) => !goneStars.has(s.id))
      .map((s) => (lessNotes.has(s.id) ? { ...s, noteCount: Math.max(0, s.noteCount - lessNotes.get(s.id)!) } : s));
    return {
      ...sky,
      stars,
      connections: sky.connections.filter((c) => !goneStars.has(c.fromStarId) && !goneStars.has(c.toStarId)),
      labels: sky.labels.map((l) => ({ ...l, starCount: stars.filter((s) => s.labelId === l.id).length })),
    };
  }, [sky, pending]);
}

export default function SkyPage({ sky: rawSky }: { sky: Sky }) {
  const sky = useVisibleSky(rawSky);
  const pending = usePendingDeletes();
  const hiddenNoteIds = useMemo(() => new Set(pending.filter((p) => p.kind === "note").map((p) => p.id)), [pending]);
  const { logout, login } = useAuth();
  const endDemo = useEndDemo();
  const actions = useSkyActions();
  const canvas = useRef<SkyCanvasHandle>(null);
  const narrow = useNarrow();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [connectMode, setConnectMode] = useState(false);
  const [connectFrom, setConnectFrom] = useState<number | null>(null);
  const [labelFilter, setLabelFilter] = useState<number | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchIds, setSearchIds] = useState<Set<number> | null>(null);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [cutoff, setCutoff] = useState<number | null>(null);
  const [awake, setAwake] = useState(true);
  const [recentOpen, setRecentOpen] = useState(false);
  const [focusNote, setFocusNote] = useState<{ starId: number; noteId: number } | null>(null);
  const [devOpen, setDevOpen] = useState(() => new URLSearchParams(window.location.search).has("dev"));
  const sleepTimer = useRef<number>(0);

  const roots = useMemo(() => componentRoots(sky.stars, sky.connections), [sky.stars, sky.connections]);
  const cviews = useMemo(() => constellationViews(sky.stars, sky.connections, sky.constellations, roots), [sky.stars, sky.connections, sky.constellations, roots]);
  const selected = sky.stars.find((s) => s.id === selectedId) ?? null;

  const highlight = useMemo(() => {
    if (searchOpen && searchIds) return searchIds;
    if (labelFilter != null) return new Set(sky.stars.filter((s) => s.labelId === labelFilter).map((s) => s.id));
    return null;
  }, [searchOpen, searchIds, labelFilter, sky.stars]);

  const wake = useCallback(() => {
    setAwake(true);
    clearTimeout(sleepTimer.current);
    sleepTimer.current = window.setTimeout(() => setAwake(false), 2800);
  }, []);
  useEffect(() => { wake(); return () => clearTimeout(sleepTimer.current); }, [wake]);

  const focusStar = useCallback((id: number) => {
    const st = sky.stars.find((s) => s.id === id);
    if (!st) return;
    setSelectedId(id);
    setFocusNote((f) => (f && f.starId === id ? f : null));
    const n = window.matchMedia("(max-width: 767px)").matches;
    canvas.current?.flyTo(st.x, st.y, n ? { dy: -window.innerHeight * 0.26 } : { dx: -210 });
  }, [sky.stars]);

  const createAt = useCallback((x: number, y: number) => {
    if (timelineOpen) return;
    actions.createStar(x, y, (s) => {
      setSelectedId(s.id);
      const n = window.matchMedia("(max-width: 767px)").matches;
      canvas.current?.flyTo(s.x, s.y, n ? { dy: -window.innerHeight * 0.26 } : { dx: -210 });
    });
  }, [actions, timelineOpen]);

  const createAtCenter = useCallback(() => {
    const c = canvas.current?.viewCenter() ?? { x: 0, y: 0 };
    createAt(Math.round(c.x + (Math.random() - 0.5) * 40), Math.round(c.y + (Math.random() - 0.5) * 40));
  }, [createAt]);

  const onStarTap = (id: number) => {
    if (connectMode) {
      if (connectFrom == null) setConnectFrom(id);
      else if (connectFrom === id) setConnectFrom(null);
      else {
        actions.connect(connectFrom, id);
        setConnectFrom(id);
      }
      return;
    }
    focusStar(id);
  };

  const exitModes = useCallback(() => {
    if (searchOpen) { setSearchOpen(false); return; }
    if (selectedId != null) { setSelectedId(null); return; }
    if (connectMode) { setConnectMode(false); setConnectFrom(null); return; }
    if (timelineOpen) { setTimelineOpen(false); setCutoff(null); return; }
    if (recentOpen) { setRecentOpen(false); return; }
    if (labelFilter != null) setLabelFilter(null);
  }, [searchOpen, selectedId, connectMode, timelineOpen, recentOpen, labelFilter]);

  const keyRef = useRef({ exitModes, createAtCenter });
  keyRef.current = { exitModes, createAtCenter };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      wake();
      const t = e.target as HTMLElement;
      const typing = t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable;
      if (e.key === "Escape") {
        if (document.querySelector("[role=alertdialog],[data-radix-popper-content-wrapper]")) return;
        if (typing) t.blur();
        keyRef.current.exitModes();
        return;
      }
      if (typing) return;
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === "z" || e.key === "Z")) {
        if (undoDelete()) e.preventDefault();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.shiftKey && (e.key === "D" || e.key === "d")) { e.preventDefault(); setDevOpen((v) => !v); return; }
      if (e.key === "r" || e.key === "R") { e.preventDefault(); setRecentOpen((v) => !v); }
      if (e.key === "n" || e.key === "N") { e.preventDefault(); keyRef.current.createAtCenter(); }
      if (e.key === "/") { e.preventDefault(); setSearchOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [wake]);

  const leaveDemo = (thenLogin: boolean) => {
    endDemo.mutate(undefined, {
      onSettled: () => { if (thenLogin) login(); else window.location.reload(); },
    });
  };

  const base = import.meta.env.BASE_URL;
  const toolbarVisible = awake || connectMode || searchOpen;
  const empty = sky.stars.length === 0;

  return (
    <div className="fixed inset-0 overflow-hidden" onPointerMove={wake}>
      <SkyCanvas
        ref={canvas}
        stars={sky.stars}
        connections={sky.connections}
        labels={sky.labels}
        constellations={cviews}
        selectedId={selectedId}
        highlight={highlight}
        connectMode={connectMode}
        connectFrom={connectFrom}
        cutoff={cutoff}
        onStarTap={onStarTap}
        onBackground={() => { setSelectedId(null); if (connectMode) setConnectFrom(null); }}
        onCreateAt={createAt}
        onMove={actions.moveStar}
        onConnect={actions.connect}
        onDeleteConnection={(id) => { actions.disconnect(id); toast({ title: "Line removed" }); }}
        onActivity={wake}
      />

      {/* top left wordmark */}
      <div className={`pointer-events-none absolute left-5 top-5 transition-opacity duration-1000 soft-ease md:left-7 md:top-6 ${toolbarVisible ? "opacity-90" : "opacity-40"}`}>
        <Wordmark />
      </div>

      {/* demo note */}
      {sky.isDemo && (
        <div className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rise max-md:top-14">
          <div className="sky-pill flex items-center gap-3 whitespace-nowrap rounded-full py-1.5 pl-4 pr-1.5 text-[12px] text-muted-foreground" data-testid="banner-demo">
            <span className="max-sm:hidden">A demo sky, just for looking around</span>
            <span className="sm:hidden">Demo sky</span>
            <button onClick={() => leaveDemo(true)} className="rounded-full bg-primary px-3 py-1 font-medium text-primary-foreground" data-testid="button-demo-login">Log in to start your own</button>
            <button onClick={() => leaveDemo(false)} className="rounded-full px-2 py-1 hover:text-foreground" data-testid="button-leave-demo">Leave demo</button>
          </div>
        </div>
      )}

      {/* connect mode hint */}
      <AnimatePresence>
        {connectMode && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.6, ease: EASE }}
            className={`absolute left-1/2 z-10 -translate-x-1/2 ${sky.isDemo ? "top-16 max-md:top-24" : "top-5"}`}>
            <div className="sky-pill rounded-full px-4 py-1.5 text-[12px] text-foreground/90" data-testid="text-connect-hint">
              {connectFrom == null ? "Choose a star to begin a line" : "Now choose the star to connect"}
              <button className="ml-3 text-muted-foreground hover:text-foreground" onClick={() => { setConnectMode(false); setConnectFrom(null); }}>Done</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* search */}
      <AnimatePresence>
        {searchOpen && (
          <motion.div initial={{ opacity: 0, y: -12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10, scale: 0.98 }} transition={{ duration: 0.55, ease: EASE }}
            className="absolute left-1/2 top-16 z-20 w-[min(92vw,30rem)] -translate-x-1/2 md:top-20">
            <SearchPanel onResults={setSearchIds} onPick={(id) => { setSearchOpen(false); focusStar(id); }} onClose={() => setSearchOpen(false)} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* first-time hint */}
      <AnimatePresence>
        {empty && !timelineOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 1.4, ease: EASE } }} transition={{ duration: 1.6, ease: EASE, delay: 0.4 }}
            className="pointer-events-none absolute inset-0 flex items-center justify-center px-8">
            <div className="text-center">
              <div className="mx-auto mb-5 h-1.5 w-1.5 rounded-full bg-[#f4e4c4] shadow-[0_0_20px_5px_rgba(244,228,196,0.3)] breathe" />
              <p className="text-[14.5px] font-light tracking-[0.01em] text-foreground/70" data-testid="text-first-star-hint">
                {narrow ? "Press and hold anywhere to place your first star." : "Double-click anywhere to place your first star."}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* on this day + dev tools (top right) */}
      <div className={`absolute right-4 top-4 z-20 flex flex-col items-end gap-3 transition-opacity duration-500 md:right-6 md:top-5 ${selected ? "pointer-events-none opacity-0" : "opacity-100"} ${sky.isDemo ? "max-md:top-[6.5rem]" : ""}`}>
        {!timelineOpen && (
          <OnThisDay
            hiddenNoteIds={hiddenNoteIds}
            onOpen={(n) => {
              setFocusNote({ starId: n.starId, noteId: n.noteId });
              focusStar(n.starId);
            }}
          />
        )}
        {devOpen && <DevPanel starCount={sky.stars.length} onClose={() => setDevOpen(false)} />}
      </div>

      {/* recent stars */}
      <AnimatePresence>
        {recentOpen && !timelineOpen && (
          <motion.div
            key="recent"
            initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.55, ease: EASE }}
            className={narrow
              ? "absolute inset-x-3 top-16 z-30 max-h-[55dvh] flex flex-col"
              : "absolute left-6 top-20 z-20 flex w-64 flex-col max-h-[calc(100dvh-22rem)] min-h-[12rem]"}
          >
            <RecentPanel
              stars={sky.stars}
              labels={sky.labels}
              selectedId={selectedId}
              onPick={(id) => { if (narrow) setRecentOpen(false); setFocusNote(null); focusStar(id); }}
              onClose={() => setRecentOpen(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* legend */}
      {!narrow || !selected ? (
        <div className={`absolute bottom-24 left-4 z-10 md:bottom-6 md:left-6 ${empty && sky.labels.length === 0 ? "hidden" : ""}`}>
          <Legend labels={sky.labels} active={labelFilter} onToggle={(id) => setLabelFilter((c) => (c === id ? null : id))} actions={actions} dimmed={!toolbarVisible && labelFilter == null} />
        </div>
      ) : null}

      {/* shortcuts hint */}
      {!narrow && (
        <div className={`pointer-events-none absolute bottom-6 right-7 text-[11px] tracking-wide text-muted-foreground/60 transition-opacity duration-1000 ${toolbarVisible && !selected ? "opacity-100" : "opacity-0"}`} data-testid="text-shortcuts">
          N new star · / search · R recent · Esc close · drag a halo to connect
        </div>
      )}

      {/* undo */}
      <div className="pointer-events-auto absolute bottom-[4.75rem] left-1/2 z-30 -translate-x-1/2 md:bottom-[5.25rem]">
        <UndoBar />
      </div>

      {/* timeline or toolbar */}
      <div className="absolute bottom-5 left-1/2 z-20 w-[min(94vw,36rem)] -translate-x-1/2 md:bottom-6" style={{ pointerEvents: "none" }}>
        <AnimatePresence mode="wait">
          {timelineOpen ? (
            <motion.div key="tl" style={{ pointerEvents: "auto" }} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }} transition={{ duration: 0.6, ease: EASE }}>
              <Timeline stars={sky.stars} onCutoff={setCutoff} onClose={() => { setTimelineOpen(false); setCutoff(null); }} />
            </motion.div>
          ) : (
            <motion.div key="tb" className="flex justify-center" initial={{ opacity: 0, y: 16 }} animate={{ opacity: toolbarVisible ? 1 : 0.22, y: 0 }} exit={{ opacity: 0, y: 16 }} transition={{ duration: 0.9, ease: EASE }}>
              <div style={{ pointerEvents: "auto" }} onPointerEnter={wake} className="sky-pill flex items-center gap-0.5 rounded-full p-1.5" data-testid="toolbar">
                <button onClick={createAtCenter} disabled={actions.creating} className="mr-1 flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-[13px] font-medium text-primary-foreground transition-all duration-500 soft-ease hover:brightness-105 disabled:opacity-60" data-testid="button-new-star">
                  <Plus className="h-4 w-4" /> New Star
                </button>
                <ToolButton label="Connect stars" active={connectMode} onClick={() => { setConnectMode((v) => !v); setConnectFrom(null); setSelectedId(null); }} testId="button-connect-mode"><Link2 className="h-4 w-4" /></ToolButton>
                <ToolButton label="Recently written" kbd="R" active={recentOpen} onClick={() => setRecentOpen((v) => !v)} testId="button-recent"><Clock className="h-4 w-4" /></ToolButton>
                <ToolButton label="Search" kbd="/" active={searchOpen} onClick={() => setSearchOpen((v) => !v)} testId="button-search"><Search className="h-4 w-4" /></ToolButton>
                <ToolButton label="Replay your sky" onClick={() => { setSelectedId(null); setConnectMode(false); setTimelineOpen(true); }} testId="button-timeline"><History className="h-4 w-4" /></ToolButton>
                {!narrow && <ToolButton label="Zoom out" onClick={() => canvas.current?.zoomBy(0.75)} testId="button-zoom-out"><ZoomOut className="h-4 w-4" /></ToolButton>}
                {!narrow && <ToolButton label="Zoom in" onClick={() => canvas.current?.zoomBy(1.33)} testId="button-zoom-in"><ZoomIn className="h-4 w-4" /></ToolButton>}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button aria-label="Export" className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/[0.07] hover:text-foreground" data-testid="button-export">
                      <Download className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="top" align="center" className="sky-glass mb-2 min-w-44 rounded-xl border-0 p-1.5">
                    <div className="px-2 pb-1.5 pt-1 text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground/70">Export journal</div>
                    <DropdownMenuItem asChild className="rounded-lg text-[13px]">
                      <a href={`${base}api/export/markdown`} download="starlog.md" data-testid="link-export-markdown">Markdown</a>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild className="rounded-lg text-[13px]">
                      <a href={`${base}api/export/json`} download="starlog.json" data-testid="link-export-json">JSON</a>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Popover>
                  <PopoverTrigger asChild>
                    <button aria-label="About your sky" className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/[0.07] hover:text-foreground" data-testid="button-menu">
                      <Menu className="h-4 w-4" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent side="top" align="end" className="sky-glass mb-2 w-72 rounded-2xl border-0 p-5">
                    <div className="mb-3 text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground/70">Your sky</div>
                    <StatsReadout />
                    <div className="my-4 h-px bg-white/[0.07]" />
                    <div className="mb-2 text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground/70">Shortcuts</div>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
                      {[["N", "New star"], ["/", "Search"], ["R", "Recently written"], ["Ctrl + Z", "Undo a delete"], ["Esc", "Close card, exit modes"], ["Double-click", "Star at that spot"], ["Drag halo", "Connect two stars"]].map(([k, v]) => (
                        <div key={k} className="contents"><dt className="font-medium text-foreground/90">{k}</dt><dd className="text-muted-foreground">{v}</dd></div>
                      ))}
                    </dl>
                    <div className="my-4 h-px bg-white/[0.07]" />
                    {sky.isDemo ? (
                      <div className="flex gap-2">
                        <button onClick={() => leaveDemo(true)} className="flex-1 rounded-full bg-primary py-2 text-[12.5px] font-medium text-primary-foreground">Log in</button>
                        <button onClick={() => leaveDemo(false)} className="flex-1 rounded-full border border-white/10 py-2 text-[12.5px] text-muted-foreground hover:text-foreground">Leave demo</button>
                      </div>
                    ) : (
                      <button onClick={logout} className="w-full rounded-full border border-white/10 py-2 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground" data-testid="button-logout">Log out</button>
                    )}
                  </PopoverContent>
                </Popover>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* journal card */}
      <AnimatePresence>
        {selected && (
          <motion.div
            key="card"
            initial={narrow ? { y: "100%", opacity: 0.6 } : { x: 28, opacity: 0, scale: 0.985 }}
            animate={narrow ? { y: 0, opacity: 1 } : { x: 0, opacity: 1, scale: 1 }}
            exit={narrow ? { y: "100%", opacity: 0.4 } : { x: 24, opacity: 0, scale: 0.985 }}
            transition={{ duration: 0.65, ease: EASE }}
            className={narrow
              ? "absolute inset-x-2 bottom-2 z-30 h-[58dvh]"
              : "absolute bottom-6 right-6 top-6 z-30 w-[400px]"}
          >
            <JournalCard star={selected} sky={sky} roots={roots} actions={actions} onClose={() => { setSelectedId(null); setFocusNote(null); }} focusNoteId={focusNote?.starId === selected.id ? focusNote.noteId : null} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
