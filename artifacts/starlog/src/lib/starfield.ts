import { hexToRgb } from "./sky";

export type BgStar = { x: number; y: number; r: number; a: number; sp: number; ph: number; depth: number; warm: boolean };

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function makeBgStars(n: number, seed = 7): BgStar[] {
  const r = rng(seed);
  return Array.from({ length: n }, () => {
    const big = r() < 0.08;
    return {
      x: r(),
      y: r(),
      r: big ? 0.9 + r() * 0.7 : 0.35 + r() * 0.55,
      a: big ? 0.5 + r() * 0.3 : 0.18 + r() * 0.35,
      sp: 0.12 + r() * 0.28,
      ph: r() * Math.PI * 2,
      depth: 0.015 + r() * 0.05,
      warm: r() < 0.3,
    };
  });
}

let gradCache: { w: number; h: number; base: CanvasGradient; glow: CanvasGradient; neb: CanvasGradient } | null = null;

export function drawSkyBackground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  stars: BgStar[],
  camX = 0,
  camY = 0,
) {
  if (!gradCache || gradCache.w !== w || gradCache.h !== h) {
    const base = ctx.createLinearGradient(0, 0, w * 0.25, h);
    base.addColorStop(0, "#130e24");
    base.addColorStop(0.45, "#1f1638");
    base.addColorStop(1, "#33214c");
    const glow = ctx.createRadialGradient(w * 0.5, h * 1.15, 0, w * 0.5, h * 1.15, Math.max(w, h) * 0.85);
    glow.addColorStop(0, "rgba(214,140,160,0.20)");
    glow.addColorStop(0.45, "rgba(150,96,160,0.08)");
    glow.addColorStop(1, "rgba(60,40,90,0)");
    const neb = ctx.createRadialGradient(w * 0.82, h * 0.18, 0, w * 0.82, h * 0.18, Math.max(w, h) * 0.55);
    neb.addColorStop(0, "rgba(160,140,230,0.10)");
    neb.addColorStop(1, "rgba(160,140,230,0)");
    gradCache = { w, h, base, glow, neb };
  }
  ctx.fillStyle = gradCache.base;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = gradCache.neb;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = gradCache.glow;
  ctx.fillRect(0, 0, w, h);

  for (const s of stars) {
    let x = (s.x * w - camX * s.depth) % w;
    let y = (s.y * h - camY * s.depth) % h;
    if (x < 0) x += w;
    if (y < 0) y += h;
    const tw = 0.62 + 0.38 * Math.sin(t * s.sp + s.ph);
    ctx.globalAlpha = s.a * tw;
    ctx.fillStyle = s.warm ? "#f6e3c8" : "#ddd6f4";
    ctx.beginPath();
    ctx.arc(x, y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

const spriteCache = new Map<string, HTMLCanvasElement>();

/** Soft glow sprite; core sits at ~7% of radius, color halo fades to 0 at the edge. */
export function getSprite(hex: string) {
  let c = spriteCache.get(hex);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const [r, gg, b] = hexToRgb(hex);
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, "rgba(255,252,246,1)");
  grd.addColorStop(0.08, "rgba(255,250,240,0.95)");
  grd.addColorStop(0.16, `rgba(${r},${gg},${b},0.9)`);
  grd.addColorStop(0.26, `rgba(${r},${gg},${b},0.35)`);
  grd.addColorStop(0.5, `rgba(${r},${gg},${b},0.09)`);
  grd.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  spriteCache.set(hex, c);
  return c;
}
