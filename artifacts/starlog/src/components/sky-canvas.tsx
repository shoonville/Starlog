import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { Connection, Label, Star } from "@workspace/api-client-react";
import { DEFAULT_STAR, MAX_ZOOM, MIN_ZOOM, hexToRgb, lighten, starRadius, type ConstellationView } from "@/lib/sky";
import { getSprite, Starfield } from "@/lib/starfield";
import { useSkyTheme } from "@/lib/sky-theme";

export type SkyCanvasHandle = {
  flyTo: (x: number, y: number, opts?: { dx?: number; dy?: number; zoom?: number }) => void;
  viewCenter: () => { x: number; y: number };
  zoomBy: (f: number) => void;
};

type Props = {
  stars: Star[];
  connections: Connection[];
  labels: Label[];
  constellations: ConstellationView[];
  selectedId: number | null;
  highlight: Set<number> | null;
  connectMode: boolean;
  connectFrom: number | null;
  cutoff: number | null;
  /** Share of a star's tasks that are done (0..1), only for stars that have tasks. */
  taskProgress?: Map<number, number>;
  onStarTap: (id: number) => void;
  /** Touch: the finger rested on a star for about half a second without moving. */
  onStarHold?: (id: number) => void;
  onBackground: () => void;
  onCreateAt: (x: number, y: number) => void;
  onMove: (id: number, x: number, y: number) => void;
  onConnect: (a: number, b: number) => void;
  onDeleteConnection: (id: number) => void;
  onActivity?: () => void;
  /** Screen space (px) covered by UI on each side; the first view keeps every star and label clear of it. */
  getInsets?: () => { top: number; right: number; bottom: number; left: number };
};

type Anim = { r: number; a: number; dim: number; hover: number; sel: number };
type Gesture =
  | { kind: "none" }
  | { kind: "done" }
  | { kind: "empty"; sx: number; sy: number; moved: boolean; lastX: number; lastY: number; lastT: number }
  | { kind: "star"; id: number; sx: number; sy: number; moved: boolean; offX: number; offY: number; slop: number }
  | { kind: "link"; id: number; sx: number; sy: number }
  | { kind: "pinch"; startDist: number; startZ: number; wx: number; wy: number };

const clampZ = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
const timeCache = new Map<string, number>();
const tms = (iso: string) => {
  let v = timeCache.get(iso);
  if (v === undefined) {
    v = Date.parse(iso);
    timeCache.set(iso, v);
  }
  return v;
};

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

type Rect = { left: number; top: number; right: number; bottom: number };

const rectsOverlap = (a: Rect, b: Rect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/** Does the segment a→b pass through the rectangle? (Liang–Barsky clip) */
function segHitsRect(ax: number, ay: number, bx: number, by: number, r: Rect) {
  const dx = bx - ax, dy = by - ay;
  let t0 = 0, t1 = 1;
  const edges: Array<[number, number]> = [[-dx, ax - r.left], [dx, r.right - ax], [-dy, ay - r.top], [dy, r.bottom - ay]];
  for (const [p, q] of edges) {
    if (Math.abs(p) < 1e-9) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return true;
}

/** Return portions of a line segment that do not pass through any exclusion rectangle. */
function lineOutsideRects(ax: number, ay: number, bx: number, by: number, rects: Rect[]) {
  const dx = bx - ax, dy = by - ay;
  const cuts: Array<[number, number]> = [];
  for (const r of rects) {
    let enter = 0, exit = 1;
    for (const [origin, delta, min, max] of [[ax, dx, r.left, r.right], [ay, dy, r.top, r.bottom]] as const) {
      if (Math.abs(delta) < 0.00001) {
        if (origin < min || origin > max) { enter = 1; exit = 0; break; }
      } else {
        const a = (min - origin) / delta, b = (max - origin) / delta;
        enter = Math.max(enter, Math.min(a, b));
        exit = Math.min(exit, Math.max(a, b));
      }
    }
    if (enter < exit && exit > 0 && enter < 1) cuts.push([Math.max(0, enter), Math.min(1, exit)]);
  }
  cuts.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const cut of cuts) {
    const last = merged[merged.length - 1];
    if (last && cut[0] <= last[1]) last[1] = Math.max(last[1], cut[1]);
    else merged.push([...cut]);
  }
  const visible: Array<[number, number, number, number]> = [];
  let from = 0;
  for (const [start, end] of merged) {
    if (start > from) visible.push([ax + dx * from, ay + dy * from, ax + dx * start, ay + dy * start]);
    from = Math.max(from, end);
  }
  if (from < 1) visible.push([ax + dx * from, ay + dy * from, bx, by]);
  return visible;
}

const SkyCanvas = forwardRef<SkyCanvasHandle, Props>(function SkyCanvas(props, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const P = useRef(props);
  P.current = props;

  const S = useRef({
    w: 0,
    h: 0,
    dpr: 1,
    cam: { x: 0, y: 0, z: 1 },
    tgt: { x: 0, y: 0, z: 1 },
    flying: false,
    anchor: null as null | { sx: number; sy: number; wx: number; wy: number },
    vel: { x: 0, y: 0 },
    anim: new Map<number, Anim>(),
    drag: null as null | { id: number; x: number; y: number },
    settle: new Map<number, { x: number; y: number; until: number }>(),
    link: null as null | { id: number; sx: number; sy: number; target: number | null },
    hoverStar: null as number | null,
    hoverRing: false,
    hoverLine: null as number | null,
    pointers: new Map<number, { x: number; y: number }>(),
    g: { kind: "none" } as Gesture,
    longTimer: 0,
    lastTap: { t: 0, x: 0, y: 0 },
    bg: new Starfield(7),
    bgOff: { x: 0, y: 0 },
    bgPrev: null as null | { x: number; y: number },
    mouse: { x: -999, y: -999 },
    initialized: false,
    /** Last chosen placement per constellation, so names don't hop between spots. */
    namePick: new Map<number, number>(),
    /** Eased task-progress values per star. */
    ring: new Map<number, number>(),
  });

  // The sky theme: set at once on mount, crossfaded on later changes.
  const theme = useSkyTheme();
  const themeSet = useRef(false);
  useEffect(() => {
    S.current.bg.setTheme(theme, !themeSet.current);
    themeSet.current = true;
  }, [theme]);

  useImperativeHandle(ref, () => ({
    flyTo(x, y, opts) {
      const s = S.current;
      s.anchor = null;
      const z = clampZ(opts?.zoom ?? Math.max(s.tgt.z, 1));
      s.tgt.z = z;
      s.tgt.x = x - (opts?.dx ?? 0) / z;
      s.tgt.y = y - (opts?.dy ?? 0) / z;
      s.flying = true;
    },
    viewCenter() {
      const s = S.current;
      return { x: s.tgt.x, y: s.tgt.y };
    },
    zoomBy(f) {
      const s = S.current;
      const wx = s.cam.x, wy = s.cam.y;
      s.tgt.z = clampZ(s.tgt.z * f);
      s.anchor = { sx: s.w / 2, sy: s.h / 2, wx, wy };
    },
  }));

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const s = S.current;
    let raf = 0;
    let last = performance.now();
    // While a star's card is open the sky is mostly covered: once the camera settles,
    // draw it at a gentle ~25fps so typing in the card stays smooth and the battery lasts.
    let selKey: number | null = null, selAt = 0, lastDraw = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      s.dpr = Math.min(window.devicePixelRatio || 1, 2);
      s.w = rect.width;
      s.h = rect.height;
      canvas.width = Math.round(rect.width * s.dpr);
      canvas.height = Math.round(rect.height * s.dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const connectionStarted = new Map<number, number>();
    let connectionsInitialized = false;

    const local = (e: { clientX: number; clientY: number }) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const toWorld = (sx: number, sy: number) => ({
      x: (sx - s.w / 2) / s.cam.z + s.cam.x,
      y: (sy - s.h / 2) / s.cam.z + s.cam.y,
    });
    const toScreen = (wx: number, wy: number) => ({
      x: (wx - s.cam.x) * s.cam.z + s.w / 2,
      y: (wy - s.cam.y) * s.cam.z + s.h / 2,
    });
    const posOf = (st: Star) => {
      if (s.drag && s.drag.id === st.id) return s.drag;
      const se = s.settle.get(st.id);
      if (se) return se;
      return st;
    };
    const visR = (id: number) => {
      const a = s.anim.get(id);
      if (!a) return 0;
      return Math.max(2.2, a.r * Math.pow(s.cam.z, 0.85) * (1 + 0.24 * a.sel + 0.08 * a.hover));
    };
    const hitStar = (sx: number, sy: number, pointerType: string) => {
      const stars = P.current.stars;
      for (let i = stars.length - 1; i >= 0; i--) {
        const st = stars[i];
        const a = s.anim.get(st.id);
        if (!a || a.a < 0.4) continue;
        const p = toScreen(posOf(st).x, posOf(st).y);
        const d = Math.hypot(sx - p.x, sy - p.y);
        if (d <= Math.max(visR(st.id), 7) + (pointerType === "mouse" ? 5 : 12)) return { id: st.id, ring: false };
      }
      if (pointerType !== "mouse" || P.current.connectMode) return null;
      for (let i = stars.length - 1; i >= 0; i--) {
        const st = stars[i];
        const a = s.anim.get(st.id);
        if (!a || a.a < 0.4) continue;
        const p = toScreen(posOf(st).x, posOf(st).y);
        const d = Math.hypot(sx - p.x, sy - p.y);
        const vr = Math.max(visR(st.id), 7) + 5;
        if (d > vr && d <= vr + 14) return { id: st.id, ring: true };
      }
      return null;
    };
    const hitLine = (sx: number, sy: number) => {
      const { connections, stars } = P.current;
      const byId = new Map(stars.map((x) => [x.id, x]));
      for (const c of connections) {
        const a = byId.get(c.fromStarId), b = byId.get(c.toStarId);
        if (!a || !b) continue;
        const aa = s.anim.get(a.id), ab = s.anim.get(b.id);
        if (!aa || !ab || aa.a < 0.4 || ab.a < 0.4) continue;
        const pa = toScreen(posOf(a).x, posOf(a).y), pb = toScreen(posOf(b).x, posOf(b).y);
        if (segDist(sx, sy, pa.x, pa.y, pb.x, pb.y) < 6) {
          // ignore if too close to an endpoint (that's a star)
          if (Math.hypot(sx - pa.x, sy - pa.y) < visR(a.id) + 8 || Math.hypot(sx - pb.x, sy - pb.y) < visR(b.id) + 8) continue;
          return c.id;
        }
      }
      return null;
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      try { canvas.setPointerCapture(e.pointerId); } catch { /* noop */ }
      const { x, y } = local(e);
      s.pointers.set(e.pointerId, { x, y });
      s.vel = { x: 0, y: 0 };
      P.current.onActivity?.();
      if (s.pointers.size === 2) {
        clearTimeout(s.longTimer);
        s.drag = null;
        s.link = null;
        const [a, b] = [...s.pointers.values()];
        const w = toWorld((a.x + b.x) / 2, (a.y + b.y) / 2);
        s.g = { kind: "pinch", startDist: Math.hypot(a.x - b.x, a.y - b.y) || 1, startZ: s.tgt.z, wx: w.x, wy: w.y };
        return;
      }
      if (s.pointers.size > 2) return;
      s.flying = false;
      const hit = hitStar(x, y, e.pointerType);
      if (hit) {
        if (hit.ring && !P.current.connectMode) {
          s.g = { kind: "link", id: hit.id, sx: x, sy: y };
          s.link = { id: hit.id, sx: x, sy: y, target: null };
        } else {
          const st = P.current.stars.find((q) => q.id === hit.id)!;
          const w = toWorld(x, y);
          const p = posOf(st);
          const touch = e.pointerType !== "mouse";
          s.g = { kind: "star", id: hit.id, sx: x, sy: y, moved: false, offX: p.x - w.x, offY: p.y - w.y, slop: touch ? 8 : 4 };
          if (touch && P.current.onStarHold) {
            // Hold still on a star → pick it for connecting. Moving first makes it a normal drag.
            s.longTimer = window.setTimeout(() => {
              const g = s.g;
              if (g.kind === "star" && g.id === hit.id && !g.moved && s.pointers.size === 1) {
                s.g = { kind: "done" };
                try { navigator.vibrate?.(12); } catch { /* noop */ }
                P.current.onStarHold?.(hit.id);
              }
            }, 500);
          }
        }
        return;
      }
      s.g = { kind: "empty", sx: x, sy: y, moved: false, lastX: x, lastY: y, lastT: performance.now() };
      if (e.pointerType !== "mouse" && !P.current.connectMode) {
        s.longTimer = window.setTimeout(() => {
          const g = s.g;
          if (g.kind === "empty" && !g.moved) {
            const w = toWorld(g.sx, g.sy);
            s.g = { kind: "done" };
            P.current.onCreateAt(Math.round(w.x), Math.round(w.y));
          }
        }, 560);
      }
    };

    const onMove = (e: PointerEvent) => {
      const { x, y } = local(e);
      s.mouse = { x, y };
      P.current.onActivity?.();
      if (s.pointers.has(e.pointerId)) s.pointers.set(e.pointerId, { x, y });
      const g = s.g;
      if (g.kind === "pinch") {
        if (s.pointers.size < 2) return;
        const [a, b] = [...s.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        s.tgt.z = clampZ((g.startZ * d) / g.startDist);
        s.anchor = { sx: (a.x + b.x) / 2, sy: (a.y + b.y) / 2, wx: g.wx, wy: g.wy };
        return;
      }
      if (g.kind === "empty") {
        if (!g.moved && Math.hypot(x - g.sx, y - g.sy) > 4) {
          g.moved = true;
          clearTimeout(s.longTimer);
        }
        if (g.moved) {
          const dx = x - g.lastX, dy = y - g.lastY;
          s.anchor = null;
          const z = s.cam.z;
          s.cam.x -= dx / z;
          s.cam.y -= dy / z;
          s.tgt.x = s.cam.x;
          s.tgt.y = s.cam.y;
          const now = performance.now();
          const dtm = Math.max(8, now - g.lastT);
          s.vel.x = s.vel.x * 0.6 + (-dx / z / dtm) * 16 * 0.4;
          s.vel.y = s.vel.y * 0.6 + (-dy / z / dtm) * 16 * 0.4;
          g.lastT = now;
        }
        g.lastX = x;
        g.lastY = y;
        canvas.style.cursor = "grabbing";
        return;
      }
      if (g.kind === "star") {
        if (!g.moved && Math.hypot(x - g.sx, y - g.sy) > g.slop) {
          g.moved = true;
          clearTimeout(s.longTimer);
        }
        if (g.moved) {
          const w = toWorld(x, y);
          s.drag = { id: g.id, x: w.x + g.offX, y: w.y + g.offY };
          canvas.style.cursor = "grabbing";
        }
        return;
      }
      if (g.kind === "link" && s.link) {
        s.link.sx = x;
        s.link.sy = y;
        const h = hitStar(x, y, "touch");
        s.link.target = h && h.id !== s.link.id ? h.id : null;
        return;
      }
      if (g.kind === "none") {
        const h = hitStar(x, y, e.pointerType);
        s.hoverStar = h?.id ?? null;
        s.hoverRing = !!h?.ring;
        s.hoverLine = h || P.current.connectMode ? null : hitLine(x, y);
        canvas.style.cursor = P.current.connectMode
          ? h ? "pointer" : "crosshair"
          : h?.ring ? "crosshair" : h ? "pointer" : s.hoverLine != null ? "pointer" : "grab";
      }
    };

    const onUp = (e: PointerEvent) => {
      s.pointers.delete(e.pointerId);
      clearTimeout(s.longTimer);
      const g = s.g;
      const { x, y } = local(e);
      if (g.kind === "pinch") {
        s.g = s.pointers.size === 0 ? { kind: "none" } : { kind: "done" };
        return;
      }
      if (s.pointers.size === 0) s.g = { kind: "none" };
      canvas.style.cursor = "grab";
      if (g.kind === "empty") {
        if (g.moved) {
          if (performance.now() - g.lastT < 80) {
            s.tgt.x += s.vel.x * 14;
            s.tgt.y += s.vel.y * 14;
          }
          return;
        }
        if (e.type === "pointercancel") return;
        if (P.current.connectMode) {
          P.current.onBackground();
          return;
        }
        const lid = P.current.connectMode ? null : hitLine(x, y);
        if (lid != null) {
          s.hoverLine = null;
          P.current.onDeleteConnection(lid);
          return;
        }
        const now = performance.now();
        if (now - s.lastTap.t < 360 && Math.hypot(x - s.lastTap.x, y - s.lastTap.y) < 26) {
          s.lastTap.t = 0;
          const w = toWorld(x, y);
          P.current.onCreateAt(Math.round(w.x), Math.round(w.y));
        } else {
          s.lastTap = { t: now, x, y };
          P.current.onBackground();
        }
        return;
      }
      if (g.kind === "star") {
        if (g.moved && s.drag) {
          const d = { id: s.drag.id, x: Math.round(s.drag.x), y: Math.round(s.drag.y) };
          s.settle.set(d.id, { x: d.x, y: d.y, until: performance.now() + 1500 });
          s.drag = null;
          P.current.onMove(d.id, d.x, d.y);
        } else if (e.type !== "pointercancel") {
          P.current.onStarTap(g.id);
        }
        return;
      }
      if (g.kind === "link" && s.link) {
        const t = s.link.target;
        const from = s.link.id;
        const moved = Math.hypot(x - g.sx, y - g.sy) > 6;
        s.link = null;
        if (t != null) P.current.onConnect(from, t);
        else if (!moved) P.current.onStarTap(from);
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      P.current.onActivity?.();
      const { x, y } = local(e);
      const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016));
      const w = toWorld(x, y);
      s.flying = false;
      s.tgt.z = clampZ(s.tgt.z * f);
      s.anchor = { sx: x, sy: y, wx: w.x, wy: w.y };
    };
    const onLeave = () => {
      s.hoverStar = null;
      s.hoverLine = null;
      s.mouse = { x: -999, y: -999 };
    };
    const noCtx = (e: Event) => e.preventDefault();
    // Stops the phone's own long-press behaviors (text selection, magnifier, callout, double-tap zoom).
    // Pointer events still fire; an input that had focus is blurred by hand.
    const noTouchDefault = (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault();
      const el = document.activeElement as HTMLElement | null;
      if (el && el !== document.body && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) el.blur();
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", noCtx);
    canvas.addEventListener("touchstart", noTouchDefault, { passive: false });

    /**
     * First view: the largest zoom (up to a gentle cap) at which every star,
     * its glow, its title and every constellation name fit inside the screen
     * minus the UI insets; then center that content in the free area.
     */
    const fitView = () => {
      const p = P.current;
      const ins = p.getInsets?.() ?? { top: 72, right: 48, bottom: 112, left: 48 };
      const availW = Math.max(120, s.w - ins.left - ins.right);
      const availH = Math.max(120, s.h - ins.top - ins.bottom);
      const stars = p.stars;
      if (!stars.length) {
        s.cam.x = s.tgt.x = 0;
        s.cam.y = s.tgt.y = 0;
        s.cam.z = 0.82;
        s.tgt.z = 1;
        return;
      }
      ctx.font = "500 11.5px Inter, ui-sans-serif, sans-serif";
      const titleHalf = stars.map((st) => {
        const title = st.title.length > 34 ? st.title.slice(0, 33) + "…" : st.title;
        return ctx.measureText(title).width / 2;
      });
      ctx.font = "500 11px Inter, ui-sans-serif, sans-serif";
      const byId = new Map(stars.map((st) => [st.id, st]));
      const cons = p.constellations
        .map((cv) => {
          const ms = cv.members.map((id) => byId.get(id)).filter((m): m is Star => !!m);
          if (ms.length < 2) return null;
          return {
            ms,
            half: ctx.measureText(cv.name.toUpperCase().split("").join("\u200A")).width / 2,
          };
        })
        .filter((c): c is { ms: Star[]; half: number } => !!c);

      const extents = (z: number) => {
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        stars.forEach((st, i) => {
          const r = Math.max(2.2, starRadius(st.noteCount) * Math.pow(z, 0.85));
          const glow = r * 1.8 + 4;
          const half = Math.max(glow, titleHalf[i]!);
          const x = st.x * z, y = st.y * z;
          x0 = Math.min(x0, x - half);
          x1 = Math.max(x1, x + half);
          y0 = Math.min(y0, y - glow);
          y1 = Math.max(y1, y + r + 9 + 15);
        });
        for (const c of cons) {
          let ax = 0, maxY = -Infinity;
          for (const m of c.ms) { ax += m.x * z; maxY = Math.max(maxY, m.y * z); }
          ax /= c.ms.length;
          x0 = Math.min(x0, ax - c.half);
          x1 = Math.max(x1, ax + c.half);
          y1 = Math.max(y1, maxY + 30 + 13);
        }
        return { x0, x1, y0, y1 };
      };
      const fits = (z: number) => {
        const e = extents(z);
        return e.x1 - e.x0 <= availW && e.y1 - e.y0 <= availH;
      };
      const cap = Math.min(1.1, MAX_ZOOM);
      let z = cap;
      if (!fits(cap)) {
        let lo = MIN_ZOOM, hi = cap;
        for (let i = 0; i < 24; i++) {
          const mid = (lo + hi) / 2;
          if (fits(mid)) lo = mid; else hi = mid;
        }
        z = lo;
      }
      const e = extents(z);
      // Content midpoint (in zoomed units) lands at the middle of the free area.
      const midX = (e.x0 + e.x1) / 2, midY = (e.y0 + e.y1) / 2;
      const freeCx = ins.left + availW / 2, freeCy = ins.top + availH / 2;
      s.cam.x = s.tgt.x = (midX - (freeCx - s.w / 2)) / z;
      s.cam.y = s.tgt.y = (midY - (freeCy - s.h / 2)) / z;
      s.cam.z = z * 0.86;
      s.tgt.z = z;
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const sel = P.current.selectedId;
      if (sel != null) {
        if (selKey !== sel) { selKey = sel; selAt = now; }
        if (now - selAt > 1500 && now - lastDraw < 40) return;
      } else selKey = null;
      lastDraw = now;
      if (!s.initialized && s.w > 0 && s.h > 0) {
        s.initialized = true;
        fitView();
      }
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = now / 1000;
      const p = P.current;
      const { w, h } = s;

      // camera
      const kz = 1 - Math.exp(-dt * 7);
      s.cam.z += (s.tgt.z - s.cam.z) * kz;
      if (s.anchor) {
        s.cam.x = s.anchor.wx - (s.anchor.sx - w / 2) / s.cam.z;
        s.cam.y = s.anchor.wy - (s.anchor.sy - h / 2) / s.cam.z;
        s.tgt.x = s.anchor.wx - (s.anchor.sx - w / 2) / s.tgt.z;
        s.tgt.y = s.anchor.wy - (s.anchor.sy - h / 2) / s.tgt.z;
        if (Math.abs(s.tgt.z - s.cam.z) < 0.0004 && s.g.kind !== "pinch") s.anchor = null;
      } else {
        const kp = 1 - Math.exp(-dt * (s.flying ? 3.4 : 6.5));
        s.cam.x += (s.tgt.x - s.cam.x) * kp;
        s.cam.y += (s.tgt.y - s.cam.y) * kp;
        if (s.flying && Math.hypot(s.tgt.x - s.cam.x, s.tgt.y - s.cam.y) < 0.3) s.flying = false;
      }

      ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
      // background starfield follows screen-space pan (not zoom), at reduced speed for depth
      if (s.bgPrev) {
        s.bgOff.x += (s.cam.x - s.bgPrev.x) * s.cam.z;
        s.bgOff.y += (s.cam.y - s.bgPrev.y) * s.cam.z;
      }
      s.bgPrev = { x: s.cam.x, y: s.cam.y };
      s.bg.draw(ctx, w, h, s.dpr, t, s.bgOff.x, s.bgOff.y);

      const byId = new Map<number, Star>();
      for (const st of p.stars) byId.set(st.id, st);
      const colorOf = new Map<number, string>();
      for (const l of p.labels) colorOf.set(l.id, l.color);

      // settle cleanup
      for (const [id, se] of s.settle) {
        const st = byId.get(id);
        if (!st || (Math.abs(st.x - se.x) < 0.5 && Math.abs(st.y - se.y) < 0.5) || now > se.until) s.settle.delete(id);
      }

      // animate
      const ka = 1 - Math.exp(-dt * 5);
      const kf = 1 - Math.exp(-dt * 9);
      for (const st of p.stars) {
        let a = s.anim.get(st.id);
        if (!a) {
          a = { r: 0, a: 0, dim: 1, hover: 0, sel: 0 };
          s.anim.set(st.id, a);
        }
        const visible = p.cutoff == null || tms(st.createdAt) <= p.cutoff;
        a.r += ((visible ? starRadius(st.noteCount) : 0) - a.r) * ka;
        a.a += ((visible ? 1 : 0) - a.a) * ka;
        a.dim += ((p.highlight ? (p.highlight.has(st.id) ? 1 : 0.16) : 1) - a.dim) * ka;
        a.hover += ((s.hoverStar === st.id || s.link?.target === st.id ? 1 : 0) - a.hover) * kf;
        a.sel += ((p.selectedId === st.id || p.connectFrom === st.id ? 1 : 0) - a.sel) * ka;
      }
      if (s.anim.size > p.stars.length) for (const id of s.anim.keys()) if (!byId.has(id)) s.anim.delete(id);

      const z = s.cam.z;
      const scr = new Map<number, { x: number; y: number }>();
      for (const st of p.stars) {
        const q = posOf(st);
        scr.set(st.id, toScreen(q.x, q.y));
      }

      const colorOfStar = (id: number) => {
        const st = byId.get(id);
        return st && st.labelId != null ? colorOf.get(st.labelId) ?? DEFAULT_STAR : DEFAULT_STAR;
      };

      // Constellation names: pick a spot near the group that covers no star and no line.
      const zoomTitleVis = Math.max(0, Math.min(1, (z - 0.8) / 0.45));
      const obstacles: Rect[] = [];
      for (const st of p.stars) {
        const q = scr.get(st.id)!, a = s.anim.get(st.id)!;
        if (a.a < 0.2 || q.x < -200 || q.y < -200 || q.x > w + 200 || q.y > h + 200) continue;
        const rr = visR(st.id) * 1.5 + 5;
        obstacles.push({ left: q.x - rr, right: q.x + rr, top: q.y - rr, bottom: q.y + rr });
        if (zoomTitleVis > 0.15 || a.sel > 0.1) {
          const tw = Math.min(st.title.length, 34) * 3.3 + 6;
          obstacles.push({ left: q.x - tw, right: q.x + tw, top: q.y + visR(st.id) + 7, bottom: q.y + visR(st.id) + 23 });
        }
      }
      const lineSegs: Array<[number, number, number, number]> = [];
      for (const c of p.connections) {
        const pa = scr.get(c.fromStarId), pb = scr.get(c.toStarId);
        if (pa && pb) lineSegs.push([pa.x, pa.y, pb.x, pb.y]);
      }
      const nameLabels: Array<{ text: string; x: number; y: number; alpha: number; rect: Rect; rgb: [number, number, number] }> = [];
      ctx.font = "500 11px Inter, ui-sans-serif, sans-serif";
      for (const cv of p.constellations) {
        let sx = 0, sy = 0, maxY = -Infinity, minY = Infinity, minX = Infinity, maxX = -Infinity, al = 0, n = 0, maxR = 0;
        const tally = new Map<string, number>();
        for (const id of cv.members) {
          const q = scr.get(id), a = s.anim.get(id);
          if (!q || !a) continue;
          sx += q.x; sy += q.y; n++;
          al += a.a * a.dim;
          maxY = Math.max(maxY, q.y); minY = Math.min(minY, q.y);
          maxX = Math.max(maxX, q.x); minX = Math.min(minX, q.x);
          maxR = Math.max(maxR, visR(id));
          const col = colorOfStar(id);
          tally.set(col, (tally.get(col) ?? 0) + 1);
        }
        if (n < 2) continue;
        al /= n;
        const text = cv.name.toUpperCase().split("").join("\u200A");
        const cx = sx / n, cy = sy / n;
        const half = ctx.measureText(text).width / 2 + 6;
        const gap = maxR * 1.5 + 14;
        const cands: Array<[number, number]> = [
          [cx, maxY + gap],
          [cx, minY - gap - 14],
          [maxX + gap + half, cy - 7],
          [minX - gap - half, cy - 7],
          [cx, maxY + gap + 22],
          [cx, minY - gap - 36],
          [cx - half * 0.8, maxY + gap],
          [cx + half * 0.8, maxY + gap],
          [cx, maxY + gap + 48],
          [cx, minY - gap - 62],
        ];
        const rectAt = ([x, y]: [number, number]): Rect => ({ left: x - half, right: x + half, top: y - 3, bottom: y + 16 });
        const free = (r: Rect) =>
          !obstacles.some((o) => rectsOverlap(o, r)) &&
          !nameLabels.some((l) => rectsOverlap(l.rect, r)) &&
          !lineSegs.some(([x1, y1, x2, y2]) => segHitsRect(x1, y1, x2, y2, r));
        const prev = s.namePick.get(cv.id);
        let pick = prev != null && prev < cands.length && free(rectAt(cands[prev]!)) ? prev : cands.findIndex((c) => free(rectAt(c)));
        if (pick < 0) pick = 0;
        s.namePick.set(cv.id, pick);
        const [x, y] = cands[pick]!;
        let best = DEFAULT_STAR, bestN = 0;
        for (const [col, k] of tally) if (k > bestN) { best = col; bestN = k; }
        nameLabels.push({ text, x, y, alpha: 0.62 * al, rect: rectAt([x, y]), rgb: lighten(best, 0.45) });
      }
      const labelRects = nameLabels.map((l) => l.rect);

      // connections
      ctx.lineCap = "round";
      const connectionIds = new Set(p.connections.map((c) => c.id));
      if (!connectionsInitialized) {
        for (const c of p.connections) connectionStarted.set(c.id, now - 1000);
        connectionsInitialized = true;
      } else {
        for (const c of p.connections) if (!connectionStarted.has(c.id)) connectionStarted.set(c.id, now);
      }
      for (const id of connectionStarted.keys()) if (!connectionIds.has(id)) connectionStarted.delete(id);
      for (const c of p.connections) {
        const pa = scr.get(c.fromStarId), pb = scr.get(c.toStarId);
        const aa = s.anim.get(c.fromStarId), ab = s.anim.get(c.toStarId);
        if (!pa || !pb || !aa || !ab) continue;
        const al = Math.min(aa.a, ab.a) * Math.min(aa.dim, ab.dim);
        if (al < 0.01) continue;
        const linearProgress = Math.max(0, Math.min(1, (now - (connectionStarted.get(c.id) ?? now)) / 850));
        const progress = 1 - Math.pow(1 - linearProgress, 3);
        const endX = pa.x + (pb.x - pa.x) * progress;
        const endY = pa.y + (pb.y - pa.y) * progress;
        const segments = lineOutsideRects(pa.x, pa.y, endX, endY, labelRects);
        const hov = s.hoverLine === c.id;
        // Lines take the colors of their two stars, at low opacity.
        const [r1, g1, b1] = hexToRgb(colorOfStar(c.fromStarId));
        const [r2, g2, b2] = hexToRgb(colorOfStar(c.toStarId));
        const lineStyle = (alpha: number) => {
          if (r1 === r2 && g1 === g2 && b1 === b2) return `rgba(${r1},${g1},${b1},${alpha})`;
          const grad = ctx.createLinearGradient(pa.x, pa.y, pb.x, pb.y);
          grad.addColorStop(0, `rgba(${r1},${g1},${b1},${alpha})`);
          grad.addColorStop(1, `rgba(${r2},${g2},${b2},${alpha})`);
          return grad;
        };
        // Lines touching a hovered star glow softly (eased via the star's hover value).
        const glow = p.connectMode || s.link ? 0 : Math.max(aa.hover, ab.hover);
        if (glow > 0.02 && !hov) {
          ctx.strokeStyle = lineStyle(0.08 * glow * al);
          ctx.lineWidth = 6;
          for (const [x1, y1, x2, y2] of segments) {
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
          }
          ctx.strokeStyle = lineStyle(0.14 * glow * al);
          ctx.lineWidth = 3;
          for (const [x1, y1, x2, y2] of segments) {
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
          }
        }
        ctx.strokeStyle = hov
          ? lineStyle(0.8 * al)
          : lineStyle((0.3 + 0.35 * glow + (1 - progress) * 0.2) * al);
        ctx.lineWidth = hov ? 1.6 : 1 + 0.3 * glow;
        for (const [x1, y1, x2, y2] of segments) {
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
        if (hov) {
          const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
          if (labelRects.some((r) => mx >= r.left && mx <= r.right && my >= r.top && my <= r.bottom)) continue;
          ctx.fillStyle = "rgba(17,17,20,0.95)";
          ctx.strokeStyle = "rgba(244,236,226,0.7)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(mx, my, 8, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(mx - 3, my - 3); ctx.lineTo(mx + 3, my + 3);
          ctx.moveTo(mx + 3, my - 3); ctx.lineTo(mx - 3, my + 3);
          ctx.stroke();
        }
      }

      // link preview
      const previewFrom = s.link ? s.link.id : p.connectMode && p.connectFrom != null ? p.connectFrom : null;
      if (previewFrom != null) {
        const a = scr.get(previewFrom);
        let tx = s.link ? s.link.sx : s.mouse.x, ty = s.link ? s.link.sy : s.mouse.y;
        const tgtId = s.link?.target ?? (p.connectMode ? s.hoverStar : null);
        if (tgtId != null && tgtId !== previewFrom && scr.get(tgtId)) { tx = scr.get(tgtId)!.x; ty = scr.get(tgtId)!.y; }
        if (a && tx > -900) {
          ctx.setLineDash([3, 5]);
          ctx.strokeStyle = `rgba(${lighten(colorOfStar(previewFrom), 0.3).join(",")},0.6)`;
          ctx.lineWidth = 1;
          for (const [x1, y1, x2, y2] of lineOutsideRects(a.x, a.y, tx, ty, labelRects)) {
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
          }
          ctx.setLineDash([]);
        }
      }

      // stars
      const margin = 80;
      for (const st of p.stars) {
        const a = s.anim.get(st.id)!;
        const q = scr.get(st.id)!;
        if (a.a < 0.01 || q.x < -margin || q.y < -margin || q.x > w + margin || q.y > h + margin) continue;
        const vr = visR(st.id) * (0.2 + 0.8 * a.a);
        const color = colorOfStar(st.id);
        const spr = getSprite(color);
        const shimmer = 0.92 + 0.08 * Math.sin(t * 0.7 + st.id * 1.7);
        ctx.globalAlpha = a.a * a.dim * Math.min(1, shimmer + 0.12 * a.hover + 0.1 * a.sel);
        const half = vr * 4;
        ctx.drawImage(spr, q.x - half, q.y - half, half * 2, half * 2);
        // Task progress: a thin, faint ring in the star's color that fills as tasks get done.
        const target = p.taskProgress?.get(st.id);
        if (target !== undefined) {
          const cur = s.ring.get(st.id) ?? target;
          const val = cur + (target - cur) * ka;
          s.ring.set(st.id, val);
          const rr = vr + 6;
          ctx.lineWidth = 1;
          ctx.strokeStyle = color;
          ctx.globalAlpha = 0.13 * a.a * a.dim;
          ctx.beginPath();
          ctx.arc(q.x, q.y, rr, 0, Math.PI * 2);
          ctx.stroke();
          if (val > 0.005) {
            ctx.globalAlpha = 0.5 * a.a * a.dim;
            ctx.beginPath();
            ctx.arc(q.x, q.y, rr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, val));
            ctx.stroke();
          }
        } else if (s.ring.has(st.id)) s.ring.delete(st.id);
        if (a.sel > 0.02) {
          ctx.globalAlpha = 0.4 * a.sel * a.a;
          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(q.x, q.y, vr + (p.taskProgress?.has(st.id) ? 13 : 12) + Math.sin(t * 1.4) * 1.6, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (a.hover > 0.02 && !p.connectMode && !s.link && s.g.kind === "none") {
          ctx.globalAlpha = a.hover * (s.hoverRing ? 0.55 : 0.16);
          ctx.strokeStyle = color;
          ctx.setLineDash(s.hoverRing ? [] : [2, 4]);
          ctx.beginPath();
          ctx.arc(q.x, q.y, Math.max(vr, 7) + 12, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      ctx.globalAlpha = 1;

      // titles
      const zoomTitle = zoomTitleVis;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.font = "500 11.5px Inter, ui-sans-serif, sans-serif";
      for (const st of p.stars) {
        const a = s.anim.get(st.id)!;
        const tAlpha = Math.max(zoomTitle * 0.5, a.hover * 0.85, a.sel * 0.9) * a.a * (0.25 + 0.75 * a.dim);
        if (tAlpha < 0.02) continue;
        const q = scr.get(st.id)!;
        if (q.x < -100 || q.y < -40 || q.x > w + 100 || q.y > h + 40) continue;
        ctx.fillStyle = `rgba(240,230,214,${tAlpha})`;
        const title = st.title.length > 34 ? st.title.slice(0, 33) + "…" : st.title;
        ctx.fillText(title, q.x, q.y + visR(st.id) + 9);
      }

      // Names are drawn over a clear gap: connection strokes are clipped around each label.
      ctx.font = "500 11px Inter, ui-sans-serif, sans-serif";
      for (const label of nameLabels) {
        ctx.fillStyle = `rgba(${label.rgb.join(",")},${label.alpha})`;
        ctx.fillText(label.text, label.x, label.y);
      }
    };
    raf = requestAnimationFrame(loop);
    // Dev only: screen positions of stars, for manual browser checks.
    if (import.meta.env.DEV) {
      (window as unknown as { __starScreen?: () => unknown }).__starScreen = () =>
        P.current.stars.map((st) => ({ id: st.id, title: st.title, ...toScreen(posOf(st).x, posOf(st).y) }));
    }

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      clearTimeout(s.longTimer);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", noCtx);
      canvas.removeEventListener("touchstart", noTouchDefault);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      data-testid="canvas-sky"
      className="absolute inset-0 h-full w-full touch-none select-none"
      style={{ cursor: "grab", WebkitTouchCallout: "none", WebkitUserSelect: "none", WebkitTapHighlightColor: "transparent" }}
    />
  );
});

export default SkyCanvas;
