import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { Connection, Label, Star } from "@workspace/api-client-react";
import { DEFAULT_STAR, MAX_ZOOM, MIN_ZOOM, starRadius, type ConstellationView } from "@/lib/sky";
import { drawSkyBackground, getSprite, makeBgStars } from "@/lib/starfield";

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
  onStarTap: (id: number) => void;
  onBackground: () => void;
  onCreateAt: (x: number, y: number) => void;
  onMove: (id: number, x: number, y: number) => void;
  onConnect: (a: number, b: number) => void;
  onDeleteConnection: (id: number) => void;
  onActivity?: () => void;
};

type Anim = { r: number; a: number; dim: number; hover: number; sel: number };
type Gesture =
  | { kind: "none" }
  | { kind: "done" }
  | { kind: "empty"; sx: number; sy: number; moved: boolean; lastX: number; lastY: number; lastT: number }
  | { kind: "star"; id: number; sx: number; sy: number; moved: boolean; offX: number; offY: number }
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
    bg: makeBgStars(280),
    mouse: { x: -999, y: -999 },
    initialized: false,
  });

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

  // center camera on first load
  useEffect(() => {
    const s = S.current;
    if (s.initialized) return;
    s.initialized = true;
    const st = props.stars;
    if (st.length) {
      let x = 0, y = 0;
      for (const a of st) { x += a.x; y += a.y; }
      x /= st.length; y /= st.length;
      s.cam.x = s.tgt.x = x;
      s.cam.y = s.tgt.y = y;
    }
    s.cam.z = 0.82;
    s.tgt.z = 1;
  }, [props.stars]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const s = S.current;
    let raf = 0;
    let last = performance.now();

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
        if (hit.ring) {
          s.g = { kind: "link", id: hit.id, sx: x, sy: y };
          s.link = { id: hit.id, sx: x, sy: y, target: null };
        } else {
          const st = P.current.stars.find((q) => q.id === hit.id)!;
          const w = toWorld(x, y);
          const p = posOf(st);
          s.g = { kind: "star", id: hit.id, sx: x, sy: y, moved: false, offX: p.x - w.x, offY: p.y - w.y };
        }
        return;
      }
      s.g = { kind: "empty", sx: x, sy: y, moved: false, lastX: x, lastY: y, lastT: performance.now() };
      if (e.pointerType !== "mouse") {
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
        if (!g.moved && Math.hypot(x - g.sx, y - g.sy) > 4) g.moved = true;
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

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", noCtx);

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
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
      drawSkyBackground(ctx, w, h, t, s.bg, s.cam.x * s.cam.z, s.cam.y * s.cam.z);

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

      // connections
      ctx.lineCap = "round";
      for (const c of p.connections) {
        const pa = scr.get(c.fromStarId), pb = scr.get(c.toStarId);
        const aa = s.anim.get(c.fromStarId), ab = s.anim.get(c.toStarId);
        if (!pa || !pb || !aa || !ab) continue;
        const al = Math.min(aa.a, ab.a) * Math.min(aa.dim, ab.dim);
        if (al < 0.01) continue;
        const hov = s.hoverLine === c.id;
        // Lines touching a hovered star glow softly (eased via the star's hover value).
        const glow = p.connectMode || s.link ? 0 : Math.max(aa.hover, ab.hover);
        if (glow > 0.02 && !hov) {
          ctx.strokeStyle = `rgba(244,224,196,${0.09 * glow * al})`;
          ctx.lineWidth = 6;
          ctx.beginPath();
          ctx.moveTo(pa.x, pa.y);
          ctx.lineTo(pb.x, pb.y);
          ctx.stroke();
          ctx.strokeStyle = `rgba(244,224,196,${0.16 * glow * al})`;
          ctx.lineWidth = 3;
          ctx.stroke();
        }
        ctx.strokeStyle = hov
          ? `rgba(244,214,190,${0.75 * al})`
          : glow > 0.02
            ? `rgba(${Math.round(214 + 30 * glow)},${Math.round(200 + 24 * glow)},${Math.round(250 - 54 * glow)},${(0.24 + 0.4 * glow) * al})`
            : `rgba(214,200,250,${0.24 * al})`;
        ctx.lineWidth = hov ? 1.6 : 1 + 0.3 * glow;
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
        if (hov) {
          const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
          ctx.fillStyle = "rgba(30,22,52,0.9)";
          ctx.strokeStyle = "rgba(244,214,190,0.7)";
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
          ctx.strokeStyle = "rgba(244,224,196,0.55)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(tx, ty);
          ctx.stroke();
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
        const color = st.labelId != null ? colorOf.get(st.labelId) ?? DEFAULT_STAR : DEFAULT_STAR;
        const spr = getSprite(color);
        const shimmer = 0.92 + 0.08 * Math.sin(t * 0.7 + st.id * 1.7);
        ctx.globalAlpha = a.a * a.dim * Math.min(1, shimmer + 0.12 * a.hover + 0.1 * a.sel);
        const half = vr * 5;
        ctx.drawImage(spr, q.x - half, q.y - half, half * 2, half * 2);
        if (a.sel > 0.02) {
          ctx.globalAlpha = 0.4 * a.sel * a.a;
          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(q.x, q.y, vr + 10 + Math.sin(t * 1.4) * 1.6, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (a.hover > 0.02 && !p.connectMode && !s.link && s.g.kind === "none") {
          ctx.globalAlpha = a.hover * (s.hoverRing ? 0.55 : 0.16);
          ctx.strokeStyle = "#f4e4c4";
          ctx.setLineDash(s.hoverRing ? [] : [2, 4]);
          ctx.beginPath();
          ctx.arc(q.x, q.y, Math.max(vr, 7) + 12, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      ctx.globalAlpha = 1;

      // titles
      const zoomTitle = Math.max(0, Math.min(1, (z - 0.8) / 0.45));
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

      // constellation names
      ctx.font = "400 11px Inter, ui-sans-serif, sans-serif";
      for (const cv of p.constellations) {
        let sx = 0, sy = 0, maxY = -Infinity, al = 0, n = 0;
        for (const id of cv.members) {
          const q = scr.get(id), a = s.anim.get(id);
          if (!q || !a) continue;
          sx += q.x; sy += q.y; n++;
          al += a.a * a.dim;
          if (q.y > maxY) maxY = q.y;
        }
        if (n < 2) continue;
        al /= n;
        const cx = sx / n;
        const cy = Math.min(maxY + 30, sy / n + 90 * Math.min(z, 1.4));
        ctx.fillStyle = `rgba(206,192,240,${0.42 * al})`;
        ctx.fillText(cv.name.toUpperCase().split("").join("\u200A"), cx, cy);
      }
    };
    raf = requestAnimationFrame(loop);

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
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      data-testid="canvas-sky"
      className="absolute inset-0 h-full w-full touch-none select-none"
      style={{ cursor: "grab" }}
    />
  );
});

export default SkyCanvas;
