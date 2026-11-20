import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { getGetSkyQueryKey, useEndDemo, useUpdatePreferences, type Sky, type SkyTheme, type Star, type Task } from "@workspace/api-client-react";
import { useAuth } from "@workspace/replit-auth-web";
import { CalendarCheck2, ChartNoAxesGantt, CircleHelp, Clock, Download, Link2, ListPlus, Menu, MoreHorizontal, Plus, Search, ZoomIn, ZoomOut } from "lucide-react";
import SkyCanvas, { type SkyCanvasHandle } from "@/components/sky-canvas";
import JournalCard, { type CardTab } from "@/components/journal-card";
import { BottomSheet, useKeyboardInset, useSheetDrag, type SheetHeight } from "@/components/bottom-sheet";
import { TodayPanel, dueTasks } from "@/components/today-panel";
import { QuickAdd } from "@/components/quick-add";
import { findStarByTitle, isOverdue, todayStr, useToday } from "@/lib/tasks";
import { CompactLegend, Legend, SearchPanel, StatsReadout, Timeline } from "@/components/sky-overlays";
import { Wordmark } from "@/components/wordmark";
import { DevPanel, OnThisDay, RecentPanel, SaveStatus, UndoBar } from "@/components/sky-extras";
import { undoDelete, usePendingDeletes } from "@/lib/pending-deletes";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSkyActions } from "@/hooks/use-sky-actions";
import { componentRoots, constellationViews, type ConstellationView } from "@/lib/sky";
import { toast } from "@/hooks/use-toast";
import { primeSkyTheme, setSkyTheme, useSkyTheme } from "@/lib/sky-theme";
import { SkyThemePicker } from "@/components/sky-theme-picker";
import { OnceTip, Welcome } from "@/components/welcome";
import { useTips } from "@/lib/onboarding";

const EASE = [0.22, 1, 0.36, 1] as const;
const HOLD_TIP_KEY = "starlog:tip-hold-connect";
/** Phone: where a focused star lands, as a share of screen height above center (the card covers ~90%). */
const PHONE_STAR_DY = 0.44;

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

function ToolButton({ label, kbd, active, onClick, children, testId, badge }: { label: string; kbd?: string; active?: boolean; onClick: () => void; children: React.ReactNode; testId: string; badge?: React.ReactNode }) {
  return (
    <TouchHint label={label}>
      <Tip label={label} kbd={kbd}>
          <button
            onClick={onClick}
            aria-label={label}
            className={`relative flex h-9 w-9 items-center justify-center rounded-full transition-all duration-500 soft-ease max-md:h-11 max-md:w-11 ${active ? "bg-primary/90 text-primary-foreground" : "text-muted-foreground hover:bg-white/[0.07] hover:text-foreground"}`}
            data-testid={testId}
          >
            {children}
            {badge}
          </button>
      </Tip>
    </TouchHint>
  );
}

/** Touch users get the same short label as desktop tooltips, shown on a long press. */
function TouchHint({ label, children }: { label: string; children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const holdTimer = useRef<number>(0);
  const hideTimer = useRef<number>(0);
  const clear = () => {
    window.clearTimeout(holdTimer.current);
    window.clearTimeout(hideTimer.current);
  };
  useEffect(() => () => clear(), []);
  return (
    <span
      className="relative inline-flex"
      onPointerDown={(e) => {
        if (e.pointerType !== "touch") return;
        clear();
        holdTimer.current = window.setTimeout(() => setVisible(true), 420);
      }}
      onPointerUp={(e) => {
        if (e.pointerType !== "touch") return;
        window.clearTimeout(holdTimer.current);
        hideTimer.current = window.setTimeout(() => setVisible(false), 1100);
      }}
      onPointerCancel={() => { clear(); setVisible(false); }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
      <AnimatePresence>
        {visible && (
          <motion.span
            initial={{ opacity: 0, y: 4, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 3 }}
            className="tip-soft pointer-events-none absolute bottom-[calc(100%+9px)] left-1/2 z-[70] -translate-x-1/2 whitespace-nowrap rounded-lg px-2.5 py-1 text-[11.5px] text-foreground"
            role="status"
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

/** Small hover label for toolbar icons. */
function Tip({ label, kbd, children }: { label: string; kbd?: string; children: React.ReactElement }) {
  return (
    <Tooltip delayDuration={250}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top" sideOffset={10} className="tip-soft rounded-lg border-0 px-2.5 py-1 text-[11.5px] text-foreground/95">
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
      tasks: sky.tasks.filter((t) => !goneStars.has(t.starId)),
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

  // Sky theme: an account's saved choice wins; the demo keeps its choice on this device only.
  const qc = useQueryClient();
  const themePrimed = useRef(false);
  if (!themePrimed.current) {
    themePrimed.current = true;
    if (!rawSky.isDemo) primeSkyTheme(rawSky.skyTheme);
  }
  useEffect(() => { if (!rawSky.isDemo) setSkyTheme(rawSky.skyTheme); }, [rawSky.isDemo, rawSky.skyTheme]);
  const skyTheme = useSkyTheme();

  // Welcome tour (once per device or account; "How it works" replays it) and one-time tips.
  const tips = useTips(rawSky);
  const [welcomeOpen, setWelcomeOpen] = useState(() => !tips.seen("welcome"));
  const welcomeRef = useRef(welcomeOpen);
  welcomeRef.current = welcomeOpen;
  const finishWelcome = () => { setWelcomeOpen(false); tips.markSeen("welcome"); };
  const [menuOpen, setMenuOpen] = useState(false);
  const showHowItWorks = () => { setMenuOpen(false); window.setTimeout(() => setWelcomeOpen(true), 120); };
  const starCardTip = tips.seen("star-card") ? null : (
    <OnceTip text="Notes and tasks live here" onDismiss={() => tips.markSeen("star-card")} className="left-1/2 top-full mt-2.5 -translate-x-1/2" testId="tip-star-card" />
  );
  const todayTip = tips.seen("today") ? null : (
    <OnceTip text="Everything due today, from every star" onDismiss={() => tips.markSeen("today")} className="left-5 top-full mt-1 md:left-6 [&>span]:left-6" testId="tip-today" />
  );
  const savePrefs = useUpdatePreferences();
  const chooseTheme = (theme: SkyTheme) => {
    if (theme === skyTheme) return;
    const prev = skyTheme;
    setSkyTheme(theme);
    if (rawSky.isDemo) return;
    const put = (t: SkyTheme) => qc.setQueryData<Sky>(getGetSkyQueryKey(), (old) => (old ? { ...old, skyTheme: t } : old));
    put(theme);
    savePrefs.mutate(
      { data: { skyTheme: theme } },
      {
        onError: () => {
          put(prev);
          setSkyTheme(prev);
          toast({ title: "Couldn't change the sky", description: "Please try again." });
        },
      },
    );
  };
  const canvas = useRef<SkyCanvasHandle>(null);
  const narrow = useNarrow();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [connectMode, setConnectMode] = useState(false);
  const [connectFrom, setConnectFrom] = useState<number | null>(null);
  /** Phone-style connecting: each tap draws (or removes) a line and moves the selection on, until cancelled. */
  const [connectChain, setConnectChain] = useState(false);
  const [holdTip, setHoldTip] = useState(false);
  const [labelFilter, setLabelFilter] = useState<number | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchIds, setSearchIds] = useState<Set<number> | null>(null);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [cutoff, setCutoff] = useState<number | null>(null);
  const [awake, setAwake] = useState(true);
  const [recentOpen, setRecentOpen] = useState(false);
  const [focusNote, setFocusNote] = useState<{ starId: number; noteId: number } | null>(null);
  const [devOpen, setDevOpen] = useState(() => new URLSearchParams(window.location.search).has("dev"));
  const [sheetHeight, setSheetHeight] = useState<SheetHeight>("full");
  const [cardTab, setCardTab] = useState<CardTab>("notes");
  const [todayOpen, setTodayOpen] = useState(false);
  const [todayHeight, setTodayHeight] = useState<SheetHeight>("half");
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const keyboard = useKeyboardInset();
  const todayDrag = useSheetDrag(todayHeight, setTodayHeight, () => setTodayOpen(false));
  const sleepTimer = useRef<number>(0);
  const legendRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  /** Screen space the UI covers, so the first view keeps every star clear of it. */
  const getInsets = useCallback(() => {
    const W = window.innerWidth, H = window.innerHeight;
    const isNarrow = W < 768;
    const edge = isNarrow ? 28 : 56;
    const top = (sky.isDemo ? (isNarrow ? 100 : 76) : isNarrow ? 64 : 72) + 8;
    const tb = toolbarRef.current?.getBoundingClientRect();
    const bottom = (tb && tb.height > 0 ? H - tb.top : isNarrow ? 68 : 72) + 40;
    const base = { top, right: edge, bottom, left: edge };
    const lg = legendRef.current?.getBoundingClientRect();
    if (!lg || lg.width === 0) return base;
    // The legend sits in the bottom-left corner: keep stars either to its right or above it,
    // whichever leaves more room.
    const besideLeft = lg.right + 28;
    const aboveBottom = H - lg.top + 28;
    const areaBeside = (W - besideLeft - edge) * (H - top - bottom);
    const areaAbove = (W - 2 * edge) * (H - top - Math.max(bottom, aboveBottom));
    return areaBeside > areaAbove ? { ...base, left: besideLeft } : { ...base, bottom: Math.max(bottom, aboveBottom) };
  }, [sky.isDemo]);

  const roots = useMemo(() => componentRoots(sky.stars, sky.connections), [sky.stars, sky.connections]);
  const cviews = useMemo(() => constellationViews(sky.stars, sky.connections, sky.constellations, roots), [sky.stars, sky.connections, sky.constellations, roots]);
  const selected = sky.stars.find((s) => s.id === selectedId) ?? null;
  useEffect(() => { if (selectedId == null) setSheetHeight("full"); }, [selectedId]);

  // Tasks: progress ring per star, and what's due for the Today button.
  const today = useToday();
  const taskProgress = useMemo(() => {
    const tally = new Map<number, [number, number]>();
    for (const t of sky.tasks) {
      const c = tally.get(t.starId) ?? [0, 0];
      c[1]++;
      if (t.done) c[0]++;
      tally.set(t.starId, c);
    }
    return new Map([...tally].map(([id, [d, n]]) => [id, d / n]));
  }, [sky.tasks]);
  const due = useMemo(() => dueTasks(sky.tasks, today), [sky.tasks, today]);
  const overdueCount = useMemo(() => due.filter((t) => isOverdue(t, today)).length, [due, today]);

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

  const focusStar = useCallback((id: number, opts?: { tab?: CardTab; keepTab?: boolean; star?: Star }) => {
    // A star created or moved a moment ago may not be up to date in this render's list, so it can be passed in.
    const st = opts?.star ?? sky.stars.find((s) => s.id === id);
    if (!st) return;
    setSelectedId(id);
    if (opts?.tab) setCardTab(opts.tab);
    else if (!opts?.keepTab) setCardTab("notes");
    setFocusNote((f) => (f && f.starId === id ? f : null));
    const n = window.matchMedia("(max-width: 767px)").matches;
    canvas.current?.flyTo(st.x, st.y, n ? { dy: -window.innerHeight * PHONE_STAR_DY } : { dx: -210 });
  }, [sky.stars]);

  /** A fresh star near the middle of the view, with a title (and label). */
  const createStarNamed = useCallback((title: string, labelId: number | null, then: (s: Star) => void) => {
    const c = canvas.current?.viewCenter() ?? { x: 0, y: 0 };
    const ang = Math.random() * Math.PI * 2;
    actions.createStar(Math.round(c.x + Math.cos(ang) * 120), Math.round(c.y + Math.sin(ang) * 90), then, { title, labelId });
  }, [actions]);
  /** Finds a star by title (e.g. Inbox, Daily log), creating it if needed. */
  const ensureStar = useCallback((title: string, then: (s: Star) => void) => {
    const found = findStarByTitle(sky.stars, title);
    if (found) then(found);
    else createStarNamed(title, null, then);
  }, [sky.stars, createStarNamed]);

  const createAt = useCallback((x: number, y: number) => {
    if (timelineOpen) return;
    actions.createStar(x, y, (s) => {
      setSelectedId(s.id);
      setCardTab("notes");
      const n = window.matchMedia("(max-width: 767px)").matches;
      canvas.current?.flyTo(s.x, s.y, n ? { dy: -window.innerHeight * PHONE_STAR_DY } : { dx: -210 });
    });
  }, [actions, timelineOpen]);

  const createAtCenter = useCallback(() => {
    const c = canvas.current?.viewCenter() ?? { x: 0, y: 0 };
    createAt(Math.round(c.x + (Math.random() - 0.5) * 40), Math.round(c.y + (Math.random() - 0.5) * 40));
  }, [createAt]);

  const endConnect = () => { setConnectMode(false); setConnectFrom(null); setConnectChain(false); };
  const dismissHoldTip = () => {
    setHoldTip(false);
    try { localStorage.setItem(HOLD_TIP_KEY, "1"); } catch { /* noop */ }
  };

  // One-time tip for phones, once there are at least two stars to connect.
  const canShowHoldTip = narrow && sky.stars.length >= 2;
  useEffect(() => {
    if (!canShowHoldTip) return;
    try { if (localStorage.getItem(HOLD_TIP_KEY)) return; } catch { return; }
    const show = window.setTimeout(() => {
      setHoldTip(true);
      try { localStorage.setItem(HOLD_TIP_KEY, "1"); } catch { /* noop */ }
    }, 1600);
    return () => clearTimeout(show);
  }, [canShowHoldTip]);
  useEffect(() => {
    if (!holdTip) return;
    const t = window.setTimeout(() => setHoldTip(false), 7000);
    return () => clearTimeout(t);
  }, [holdTip]);

  /** Touch: holding a star picks it for connecting. */
  const onStarHold = (id: number) => {
    dismissHoldTip();
    setSelectedId(null);
    setFocusNote(null);
    setSearchOpen(false);
    setQuickAddOpen(false);
    if (narrow) setTodayOpen(false);
    setConnectMode(true);
    setConnectChain(true);
    setConnectFrom(id);
  };

  const onStarTap = (id: number) => {
    if (connectMode && connectChain) {
      if (connectFrom == null) { setConnectFrom(id); return; }
      if (connectFrom === id) return;
      const existing = sky.connections.find((c) =>
        (c.fromStarId === connectFrom && c.toStarId === id) || (c.fromStarId === id && c.toStarId === connectFrom));
      if (existing) {
        actions.disconnect(existing.id);
        toast({ title: "Line removed" });
      } else {
        actions.connect(connectFrom, id);
        setConnectFrom(id);
      }
      return;
    }
    if (connectMode) {
      if (connectFrom == null) setConnectFrom(id);
      else if (connectFrom === id) return;
      else {
        actions.connect(connectFrom, id);
        endConnect();
        focusStar(id);
      }
      return;
    }
    focusStar(id);
  };

  const exitModes = useCallback(() => {
    if (quickAddOpen) { setQuickAddOpen(false); return; }
    if (searchOpen) { setSearchOpen(false); return; }
    if (todayOpen) { setTodayOpen(false); return; }
    if (selectedId != null) { setSelectedId(null); return; }
    if (connectMode) { endConnect(); return; }
    if (timelineOpen) { setTimelineOpen(false); setCutoff(null); return; }
    if (recentOpen) { setRecentOpen(false); return; }
    if (labelFilter != null) setLabelFilter(null);
  }, [quickAddOpen, searchOpen, todayOpen, selectedId, connectMode, timelineOpen, recentOpen, labelFilter]);

  const keyRef = useRef({ exitModes, createAtCenter });
  keyRef.current = { exitModes, createAtCenter };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (welcomeRef.current) return;
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
      if (e.key === "t" || e.key === "T") { e.preventDefault(); setTodayOpen((v) => !v); }
      if (e.key === "a" || e.key === "A") { e.preventDefault(); setQuickAddOpen(true); }
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
  const openToday = () => { setQuickAddOpen(false); if (!narrow) setRecentOpen(false); if (narrow) setSelectedId(null); setTodayOpen((v) => !v); };
  const openQuickAdd = () => { setSearchOpen(false); if (narrow) setTodayOpen(false); setQuickAddOpen(true); };
  const startConnect = () => { setConnectChain(narrow); setConnectMode((v) => !v); setConnectFrom(null); setSelectedId(null); };
  const openTimeline = () => { setSelectedId(null); setConnectMode(false); setTodayOpen(false); setTimelineOpen(true); };
  const pickTodayTask = (t: Task) => {
    setTodayOpen(false);
    setFocusNote(null);
    focusStar(t.starId, { tab: "tasks" });
  };
  const todayBadge = due.length > 0 ? (
    <span
      className={`pointer-events-none absolute -right-0.5 -top-0.5 flex h-[17px] min-w-[17px] items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums ${overdueCount > 0 ? "bg-[hsl(0_70%_72%)] text-black" : "bg-white/85 text-black"}`}
      aria-label={`${due.length} due${overdueCount ? `, ${overdueCount} overdue` : ""}`}
      data-testid="badge-today"
    >
      {due.length}
    </span>
  ) : null;
  const toolbarVisible = awake || connectMode || searchOpen || todayOpen || quickAddOpen;
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
        taskProgress={taskProgress}
        onStarTap={onStarTap}
        onStarHold={onStarHold}
        onBackground={() => {
          if (holdTip) dismissHoldTip();
          if (connectMode) endConnect();
          else if (narrow && todayOpen) setTodayOpen(false);
          else setSelectedId(null);
        }}
        onCreateAt={createAt}
        onMove={actions.moveStar}
        onConnect={actions.connect}
        onDeleteConnection={(id) => { actions.disconnect(id); toast({ title: "Line removed" }); }}
        onActivity={wake}
        getInsets={getInsets}
      />

      {/* top left wordmark */}
      <div className={`pointer-events-none absolute left-5 top-5 transition-opacity duration-1000 soft-ease md:left-7 md:top-6 ${toolbarVisible ? "opacity-90" : "opacity-40"}`}>
        <Wordmark />
      </div>

      {/* demo note */}
      {sky.isDemo && !(narrow && selected) && (
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
            className={`absolute left-1/2 z-10 -translate-x-1/2 ${sky.isDemo ? "top-16 max-md:top-[8.5rem]" : "top-5"}`}>
            {connectChain ? (
              <div className="sky-pill flex items-center whitespace-nowrap rounded-full pl-4 pr-1 text-[12.5px] text-foreground/90" data-testid="text-connect-hint">
                {connectFrom == null ? "Tap a star to begin a line" : "Tap a star to connect"}
                <span className="ml-2 text-muted-foreground/50">·</span>
                <button className="flex h-11 items-center px-3 text-muted-foreground hover:text-foreground" onClick={endConnect} data-testid="button-cancel-connect">Cancel</button>
              </div>
            ) : (
              <div className="sky-pill rounded-full px-4 py-1.5 text-[12px] text-foreground/90" data-testid="text-connect-hint">
                {connectFrom == null ? "Choose a star to begin a line" : "Tap another star to connect"}
                <button className="ml-3 text-muted-foreground hover:text-foreground" onClick={endConnect}>Cancel</button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* one-time phone tip */}
      <AnimatePresence>
        {holdTip && !connectMode && !selected && (
          <motion.button
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.6, ease: EASE }}
            onClick={dismissHoldTip}
            className={`absolute left-1/2 z-10 -translate-x-1/2 ${sky.isDemo ? "top-[8.75rem]" : "top-16"}`}
            data-testid="tip-hold-connect"
          >
            <span className="sky-pill block whitespace-nowrap rounded-full px-4 py-2 text-[12.5px] text-foreground/90">Hold a star to connect it</span>
          </motion.button>
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
            <div className="text-center" data-testid="empty-sky">
              <div className="mx-auto mb-5 h-1.5 w-1.5 rounded-full bg-[#f4e4c4] shadow-[0_0_20px_5px_rgba(244,228,196,0.3)] breathe" />
              <p className="text-[17px] font-light tracking-[-0.005em] text-foreground/85">Your sky is empty.</p>
              <p className="mt-1.5 text-[14px] font-light tracking-[0.01em] text-foreground/60" data-testid="text-first-star-hint">
                {narrow ? "Tap + to light your first star." : "Click New Star to light your first star."}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* dev tools (top right) */}
      <div className={`absolute right-4 top-4 z-20 flex flex-col items-end gap-3 transition-opacity duration-500 md:right-6 md:top-5 ${selected ? "pointer-events-none opacity-0" : "opacity-100"} ${sky.isDemo ? "max-md:top-[6.5rem]" : ""}`}>
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
      {!narrow || (!selected && !todayOpen && !quickAddOpen) ? (
        <div ref={legendRef} className={`absolute bottom-24 left-4 z-10 md:bottom-6 md:left-6 ${empty && sky.labels.length === 0 ? "hidden" : ""}`}>
          {narrow ? (
            <CompactLegend labels={sky.labels} active={labelFilter} onToggle={(id) => setLabelFilter((c) => (c === id ? null : id))} actions={actions} dimmed={!toolbarVisible && labelFilter == null} />
          ) : (
            <Legend labels={sky.labels} active={labelFilter} onToggle={(id) => setLabelFilter((c) => (c === id ? null : id))} actions={actions} dimmed={!toolbarVisible && labelFilter == null} />
          )}
        </div>
      ) : null}

      {/* shortcuts hint */}
      {!narrow && (
        <div className={`pointer-events-none absolute bottom-6 right-7 text-[11px] tracking-wide text-muted-foreground/60 transition-opacity duration-1000 ${toolbarVisible && !selected ? "opacity-100" : "opacity-0"}`} data-testid="text-shortcuts">
          N new star · A add task · T today · / search · Esc close
        </div>
      )}

      {/* undo */}
      <div className="pointer-events-auto absolute bottom-[4.75rem] left-1/2 z-30 -translate-x-1/2 md:bottom-[5.25rem]">
        <div className="flex flex-col items-center gap-2">
          {!narrow && <SaveStatus />}
          <UndoBar />
        </div>
      </div>

      {/* timeline or toolbar */}
      <div className="absolute bottom-5 left-1/2 z-20 w-[min(94vw,36rem)] -translate-x-1/2 md:bottom-6" style={{ pointerEvents: "none" }}>
        <AnimatePresence mode="wait">
          {timelineOpen ? (
            <motion.div key="tl" style={{ pointerEvents: "auto" }} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }} transition={{ duration: 0.6, ease: EASE }}>
              <Timeline stars={sky.stars} onCutoff={setCutoff} onClose={() => { setTimelineOpen(false); setCutoff(null); }} />
            </motion.div>
          ) : selected && narrow ? null : (
            <motion.div key="tb" className="flex justify-center" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }} transition={{ duration: 0.9, ease: EASE }}>
              <div ref={toolbarRef} style={{ pointerEvents: "auto" }} onPointerEnter={wake} className={`sky-dock flex items-center gap-0.5 rounded-full p-1.5 ${toolbarVisible ? "" : "dock-asleep"}`} data-testid="toolbar">
                {narrow ? (
                  <>
                    <ToolButton label="Today" active={todayOpen} onClick={openToday} testId="button-today" badge={todayBadge}><CalendarCheck2 className="h-[18px] w-[18px]" /></ToolButton>
                    <ToolButton label="Search" active={searchOpen} onClick={() => setSearchOpen((v) => !v)} testId="button-search"><Search className="h-[18px] w-[18px]" /></ToolButton>
                    <TouchHint label={empty ? "New star" : "Add a task"}>
                      <button onClick={empty ? createAtCenter : openQuickAdd} aria-label={empty ? "New star" : "Add a task"} className="mx-1 flex h-11 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground transition-all duration-500 soft-ease active:scale-95" data-testid="button-quick-add">
                        <Plus className="h-5 w-5" />
                      </button>
                    </TouchHint>
                    {moreMenu()}
                  </>
                ) : (
                  <>
                    <TouchHint label="New star">
                      <button onClick={createAtCenter} disabled={actions.creating} className="mr-1 flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-[13px] font-medium text-primary-foreground transition-all duration-500 soft-ease hover:brightness-105 disabled:opacity-60" data-testid="button-new-star">
                        <Plus className="h-4 w-4" /> New Star
                      </button>
                    </TouchHint>
                    <ToolButton label="Today" kbd="T" active={todayOpen} onClick={openToday} testId="button-today" badge={todayBadge}><CalendarCheck2 className="h-4 w-4" /></ToolButton>
                    <ToolButton label="Add a task" kbd="A" active={quickAddOpen} onClick={openQuickAdd} testId="button-quick-add"><ListPlus className="h-4 w-4" /></ToolButton>
                    <ToolButton label="Connect stars" active={connectMode} onClick={startConnect} testId="button-connect-mode"><Link2 className="h-4 w-4" /></ToolButton>
                    <ToolButton label="Recent stars" kbd="R" active={recentOpen} onClick={() => setRecentOpen((v) => !v)} testId="button-recent"><Clock className="h-4 w-4" /></ToolButton>
                    <ToolButton label="Search" kbd="/" active={searchOpen} onClick={() => setSearchOpen((v) => !v)} testId="button-search"><Search className="h-4 w-4" /></ToolButton>
                    <ToolButton label="Timeline" onClick={openTimeline} testId="button-timeline"><ChartNoAxesGantt className="h-4 w-4" /></ToolButton>
                    <ToolButton label="Zoom out" onClick={() => canvas.current?.zoomBy(0.75)} testId="button-zoom-out"><ZoomOut className="h-4 w-4" /></ToolButton>
                    <ToolButton label="Zoom in" onClick={() => canvas.current?.zoomBy(1.33)} testId="button-zoom-in"><ZoomIn className="h-4 w-4" /></ToolButton>
                    <TouchHint label="Export journal">
                    <DropdownMenu>
                      <Tip label="Export journal">
                      <DropdownMenuTrigger asChild>
                        <button aria-label="Export journal" className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/[0.07] hover:text-foreground" data-testid="button-export">
                          <Download className="h-4 w-4" />
                        </button>
                      </DropdownMenuTrigger>
                      </Tip>
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
                    </TouchHint>
                    <TouchHint label="Your sky and shortcuts">
                    <Popover open={menuOpen} onOpenChange={setMenuOpen}>
                      <Tip label="Your sky and shortcuts">
                      <PopoverTrigger asChild>
                        <button aria-label="Your sky and shortcuts" className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/[0.07] hover:text-foreground" data-testid="button-menu">
                          <Menu className="h-4 w-4" />
                        </button>
                      </PopoverTrigger>
                      </Tip>
                      <PopoverContent side="top" align="end" className="sky-glass mb-2 w-72 rounded-2xl border-0 p-5">
                        <div className="mb-3 text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground/70">Your sky</div>
                        <StatsReadout />
                        <div className="my-4 h-px bg-white/[0.07]" />
                        <SkyThemePicker value={skyTheme} onChange={chooseTheme} />
                        <div className="my-4 h-px bg-white/[0.07]" />
                        <div className="mb-2 text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground/70">Shortcuts</div>
                        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
                          {[["N", "New star"], ["A", "Quick add a task"], ["T", "Today"], ["/", "Search"], ["R", "Recent stars"], ["Ctrl + Z", "Undo a delete"], ["Esc", "Close card, exit modes"], ["Double-click", "Star at that spot"], ["Drag halo", "Connect two stars"]].map(([k, v]) => (
                            <div key={k} className="contents"><dt className="font-medium text-foreground/90">{k}</dt><dd className="text-muted-foreground">{v}</dd></div>
                          ))}
                        </dl>
                        <button onClick={showHowItWorks} className="mt-3.5 flex items-center gap-2 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground" data-testid="button-how-it-works">
                          <CircleHelp className="h-3.5 w-3.5" /> How it works
                        </button>
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
                    </TouchHint>
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* today */}
      <AnimatePresence>
        {todayOpen && (narrow ? (
          <BottomSheet key="today" height={todayHeight} testId="sheet-today" z={35}>
            <TodayPanel
              sky={sky}
              actions={actions}
              onPickTask={pickTodayTask}
              onClose={() => setTodayOpen(false)}
              ensureStar={ensureStar}
              tip={todayTip}
              onThisDay={!timelineOpen ? (
                <OnThisDay
                  hiddenNoteIds={hiddenNoteIds}
                  onOpen={(n) => {
                    setFocusNote({ starId: n.starId, noteId: n.noteId });
                    focusStar(n.starId);
                  }}
                />
              ) : null}
              handle={
                <div
                  className="flex h-6 w-full shrink-0 touch-none items-center justify-center"
                  onPointerDown={todayDrag.onSheetHandleDown}
                  onPointerMove={todayDrag.onSheetHandleMove}
                  onPointerUp={todayDrag.onSheetHandleUp}
                  onPointerCancel={todayDrag.onSheetHandleCancel}
                  data-testid="today-drag-handle"
                >
                  <span className="h-1 w-10 rounded-full bg-white/20" />
                </div>
              }
            />
          </BottomSheet>
        ) : (
          <motion.div
            key="today"
            initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.55, ease: EASE }}
            className="absolute left-6 top-20 z-20 flex max-h-[calc(100dvh-12rem)] min-h-[14rem] w-[22rem] flex-col"
          >
            <TodayPanel
              sky={sky}
              actions={actions}
              onPickTask={pickTodayTask}
              onClose={() => setTodayOpen(false)}
              ensureStar={ensureStar}
              tip={todayTip}
              onThisDay={!timelineOpen ? (
                <OnThisDay
                  hiddenNoteIds={hiddenNoteIds}
                  onOpen={(n) => {
                    setFocusNote({ starId: n.starId, noteId: n.noteId });
                    focusStar(n.starId);
                  }}
                />
              ) : null}
            />
          </motion.div>
        ))}
      </AnimatePresence>

      {/* quick add */}
      <AnimatePresence>
        {quickAddOpen && (
          <>
            {narrow && <motion.div key="qa-veil" className="fixed inset-0 z-[39] bg-black/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setQuickAddOpen(false)} />}
            <motion.div
              key="qa"
              initial={{ opacity: 0, y: narrow ? 24 : -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: narrow ? 24 : -10 }} transition={{ duration: 0.45, ease: EASE }}
              className={narrow ? "fixed inset-x-3 z-40" : "absolute left-1/2 top-20 z-30 w-[min(92vw,34rem)] -translate-x-1/2"}
              style={narrow ? { bottom: keyboard.inset + 12 } : undefined}
            >
              <QuickAdd
                sky={sky}
                actions={actions}
                ensureStar={ensureStar}
                createStarNamed={createStarNamed}
                onClose={() => setQuickAddOpen(false)}
                onAdded={(star, title, isNew) => {
                  setQuickAddOpen(false);
                  if (!narrow && selectedId === star.id) setCardTab("tasks");
                  toast({ title: `Added to ${star.title}`, description: title });
                  if (narrow || isNew || selectedId != null) focusStar(star.id, { tab: "tasks", star });
                  else canvas.current?.flyTo(star.x, star.y);
                }}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* journal card */}
      <AnimatePresence>
        {selected && (narrow ? (
          <BottomSheet key="card" height={sheetHeight} testId="sheet-card" tall>
            {card(selected)}
          </BottomSheet>
        ) : (
          <motion.div
            key="card"
            initial={{ x: 28, opacity: 0, scale: 0.985 }}
            animate={{ x: 0, opacity: 1, scale: 1 }}
            exit={{ x: 24, opacity: 0, scale: 0.985 }}
            transition={{ duration: 0.65, ease: EASE }}
            className="absolute bottom-6 right-6 top-6 z-30 w-[400px]"
          >
            {card(selected)}
          </motion.div>
        ))}
      </AnimatePresence>

      {/* phone: save problems show at the top, above any open sheet */}
      {narrow && (
        <div className="pointer-events-none fixed left-1/2 top-[calc(env(safe-area-inset-top)+0.6rem)] z-[60] -translate-x-1/2">
          <SaveStatus />
        </div>
      )}

      {/* welcome tour */}
      <AnimatePresence>{welcomeOpen && <Welcome key="welcome" onDone={finishWelcome} />}</AnimatePresence>
    </div>
  );

  function card(star: Star) {
    return (
      <JournalCard
        star={star}
        sky={sky}
        roots={roots}
        actions={actions}
        onClose={() => { setSelectedId(null); setFocusNote(null); }}
        onStartConnect={(id) => { setSelectedId(null); setFocusNote(null); setConnectFrom(id); setConnectChain(narrow); setConnectMode(true); }}
        sheetHeight={sheetHeight}
        onSheetHeightChange={setSheetHeight}
        narrow={narrow}
        focusNoteId={focusNote?.starId === star.id ? focusNote.noteId : null}
        tab={cardTab}
        onTabChange={setCardTab}
        onSwitchStar={(id) => { setFocusNote(null); focusStar(id, { keepTab: true }); }}
        onStarMoved={(st) => focusStar(st.id, { keepTab: true, star: st })}
        tip={starCardTip}
        constellations={cviews}
        onPickConstellation={(cv: ConstellationView) => { setFocusNote(null); if (cv.members[0] != null) focusStar(cv.members[0]); }}
      />
    );
  }

  /** Phone "More" menu: connect, recent, timeline, filters, export, account. */
  function moreMenu() {
    const item = "min-h-11 rounded-lg px-3 text-[14px]";
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button aria-label="More" className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/[0.07] hover:text-foreground" data-testid="button-more">
            <MoreHorizontal className="h-[18px] w-[18px]" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" sideOffset={12} className="sheet-panel mb-1 max-h-[70dvh] w-64 overflow-y-auto rounded-2xl p-1.5" data-testid="menu-more">
          <DropdownMenuItem className={item} onSelect={createAtCenter} data-testid="menu-new-star"><Plus className="mr-2.5 h-4 w-4" />New star</DropdownMenuItem>
          <DropdownMenuItem className={item} onSelect={startConnect} data-testid="menu-connect"><Link2 className="mr-2.5 h-4 w-4" />Connect stars</DropdownMenuItem>
          <DropdownMenuItem className={item} onSelect={() => setRecentOpen((v) => !v)} data-testid="menu-recent"><Clock className="mr-2.5 h-4 w-4" />Recent stars</DropdownMenuItem>
          <DropdownMenuItem className={item} onSelect={openTimeline} data-testid="menu-timeline"><ChartNoAxesGantt className="mr-2.5 h-4 w-4" />Timeline</DropdownMenuItem>
          {sky.labels.length > 0 && (
            <>
              <DropdownMenuSeparator className="my-1.5 bg-white/[0.06]" />
              <div className="px-3 pb-1 pt-1 text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground/70">Filter by label</div>
              {sky.labels.map((l) => (
                <DropdownMenuItem key={l.id} className={item} onSelect={() => setLabelFilter((c) => (c === l.id ? null : l.id))} data-testid={`menu-filter-${l.id}`}>
                  <span className="mr-3 h-2 w-2 rounded-full" style={{ background: l.color, boxShadow: labelFilter === l.id ? `0 0 8px ${l.color}` : undefined }} />
                  <span className={`flex-1 truncate ${labelFilter === l.id ? "text-foreground" : ""}`}>{l.name}</span>
                  {labelFilter === l.id && <span className="text-[11px] text-muted-foreground">On</span>}
                </DropdownMenuItem>
              ))}
            </>
          )}
          <DropdownMenuSeparator className="my-1.5 bg-white/[0.06]" />
          <SkyThemePicker value={skyTheme} onChange={chooseTheme} className="px-2 pb-2 pt-1.5" />
          <DropdownMenuSeparator className="my-1.5 bg-white/[0.06]" />
          <DropdownMenuItem asChild className={item}>
            <a href={`${base}api/export/markdown`} download="starlog.md" data-testid="link-export-markdown"><Download className="mr-2.5 h-4 w-4" />Export as Markdown</a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className={item}>
            <a href={`${base}api/export/json`} download="starlog.json" data-testid="link-export-json"><Download className="mr-2.5 h-4 w-4" />Export as JSON</a>
          </DropdownMenuItem>
          <DropdownMenuItem className={item} onSelect={showHowItWorks} data-testid="menu-how-it-works"><CircleHelp className="mr-2.5 h-4 w-4" />How it works</DropdownMenuItem>
          <DropdownMenuSeparator className="my-1.5 bg-white/[0.06]" />
          {sky.isDemo ? (
            <>
              <DropdownMenuItem className={item} onSelect={() => leaveDemo(true)}>Log in to start your own</DropdownMenuItem>
              <DropdownMenuItem className={item} onSelect={() => leaveDemo(false)}>Leave demo</DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem className={item} onSelect={logout} data-testid="button-logout">Log out</DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
}
