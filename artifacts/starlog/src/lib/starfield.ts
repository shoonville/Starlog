import { hexToRgb } from "./sky";

type Dot = { x: number; y: number; r: number; a: number };
type Twinkler = Dot & { sp: number; ph: number };
type Layer = { depth: number; dots: Dot[]; tile: HTMLCanvasElement | null };

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const mod = (v: number, m: number) => ((v % m) + m) % m;

/**
 * Faint decorative starfield on a true-black sky.
 * Dots are rendered once into offscreen tiles (one per depth layer) and blitted with a
 * parallax offset each frame; only a handful of slow twinklers are drawn per frame.
 * Positions are normalized (0..1) so the field keeps its layout across resizes.
 */
export class Starfield {
  private layers: Layer[];
  private twinklers: Twinkler[];
  private w = 0;
  private h = 0;
  private dpr = 0;

  constructor(seed = 7) {
    const r = rng(seed);
    // Generated for up to 4,000,000 CSS px²; the viewport area decides how many are used.
    const far: Dot[] = Array.from({ length: 560 }, () => ({ x: r(), y: r(), r: 0.5, a: 0.06 + r() * 0.1 }));
    const near: Dot[] = Array.from({ length: 280 }, () => {
      const big = r() < 0.3;
      return { x: r(), y: r(), r: big ? 0.85 + r() * 0.15 : 0.5 + r() * 0.2, a: 0.1 + r() * 0.15 };
    });
    this.layers = [
      { depth: 0.5, dots: far, tile: null },
      { depth: 0.72, dots: near, tile: null },
    ];
    this.twinklers = Array.from({ length: 48 }, () => ({
      x: r(),
      y: r(),
      r: 0.55 + r() * 0.35,
      a: 0.13 + r() * 0.13,
      sp: (Math.PI * 2) / (9 + r() * 9), // one slow breath every 9–18s
      ph: r() * Math.PI * 2,
    }));
  }

  private build(w: number, h: number, dpr: number) {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    const area = (w * h) / 1_000_000;
    const W = Math.max(1, Math.round(w * dpr));
    const H = Math.max(1, Math.round(h * dpr));
    for (const layer of this.layers) {
      const tile = layer.tile ?? document.createElement("canvas");
      tile.width = W;
      tile.height = H;
      const g = tile.getContext("2d")!;
      g.clearRect(0, 0, W, H);
      g.fillStyle = "#ffffff";
      const n = Math.min(layer.dots.length, Math.ceil((layer.dots.length / 4) * Math.max(0.4, area)));
      for (let i = 0; i < n; i++) {
        const d = layer.dots[i];
        const x = Math.round(d.x * W) + 0.5;
        const y = Math.round(d.y * H) + 0.5;
        const rad = d.r * dpr;
        g.globalAlpha = d.a;
        // draw wrapped copies near edges so the tile repeats seamlessly
        for (const ox of x < 3 ? [0, W] : x > W - 3 ? [0, -W] : [0]) {
          for (const oy of y < 3 ? [0, H] : y > H - 3 ? [0, -H] : [0]) {
            g.beginPath();
            g.arc(x + ox, y + oy, rad, 0, Math.PI * 2);
            g.fill();
          }
        }
      }
      layer.tile = tile;
    }
  }

  /** Paints black sky + starfield. offX/offY are accumulated screen-space pan in CSS px. */
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number, t: number, offX = 0, offY = 0) {
    if (w <= 0 || h <= 0) return;
    if (w !== this.w || h !== this.h || dpr !== this.dpr) this.build(w, h, dpr);
    const W = Math.round(w * dpr);
    const H = Math.round(h * dpr);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    for (const layer of this.layers) {
      const tile = layer.tile!;
      // snap to whole device pixels so tiny dots stay crisp while panning
      const ox = Math.round(mod(-offX * layer.depth * dpr, W));
      const oy = Math.round(mod(-offY * layer.depth * dpr, H));
      ctx.drawImage(tile, ox, oy);
      if (ox > 0) ctx.drawImage(tile, ox - W, oy);
      if (oy > 0) ctx.drawImage(tile, ox, oy - H);
      if (ox > 0 && oy > 0) ctx.drawImage(tile, ox - W, oy - H);
    }
    const depth = this.layers[1].depth;
    const n = Math.max(5, Math.min(this.twinklers.length, Math.round((this.twinklers.length / 4) * (w * h) / 1_000_000)));
    ctx.fillStyle = "#ffffff";
    for (let i = 0; i < n; i++) {
      const s = this.twinklers[i];
      const x = Math.round(mod(s.x * W - offX * depth * dpr, W)) + 0.5;
      const y = Math.round(mod(s.y * H - offY * depth * dpr, H)) + 0.5;
      const k = 0.5 + 0.5 * Math.sin(t * s.sp + s.ph);
      ctx.globalAlpha = s.a * (0.25 + 0.75 * k * k);
      ctx.beginPath();
      ctx.arc(x, y, s.r * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

const spriteCache = new Map<string, HTMLCanvasElement>();

/**
 * Soft star sprite tinted with its own color. Draw it at 4x the star's radius:
 * the colored disc fills the inner quarter, the glow fades out to the edge.
 */
export function getSprite(hex: string) {
  let c = spriteCache.get(hex);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = c.height = 160;
  const g = c.getContext("2d")!;
  const [r, gg, b] = hexToRgb(hex);
  const mix = (k: number) => [r, gg, b].map((v) => Math.round(v + (255 - v) * k)).join(",");
  const grd = g.createRadialGradient(80, 80, 0, 80, 80, 80);
  grd.addColorStop(0, `rgba(${mix(0.62)},1)`);
  grd.addColorStop(0.1, `rgba(${mix(0.32)},1)`);
  grd.addColorStop(0.2, `rgba(${mix(0.08)},0.96)`);
  grd.addColorStop(0.26, `rgba(${r},${gg},${b},0.62)`);
  grd.addColorStop(0.36, `rgba(${r},${gg},${b},0.32)`);
  grd.addColorStop(0.55, `rgba(${r},${gg},${b},0.14)`);
  grd.addColorStop(0.78, `rgba(${r},${gg},${b},0.05)`);
  grd.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  g.fillStyle = grd;
  g.fillRect(0, 0, 160, 160);
  spriteCache.set(hex, c);
  return c;
}
