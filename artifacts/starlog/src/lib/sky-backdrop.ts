import type { SkyTheme } from "@workspace/api-client-react";

/**
 * Sky themes: the backdrop painted behind the starfield.
 *
 * Every theme is a flat base color plus a few soft layers. Each layer is painted once, pixel by pixel,
 * into an offscreen tile at reduced resolution (the content is all soft light) and then only blitted
 * each frame, added on top of the base with the "lighter" blend. Tiles wrap seamlessly, so they can
 * follow panning at a slow parallax forever. Tiles are rebuilt only when the screen size changes enough
 * to need a bigger tile.
 */

type Layer =
  /** Wraps in both directions with period `size` (CSS px), moves at `depth` × pan. */
  | { kind: "torus"; tile: HTMLCanvasElement; size: number; depth: number }
  /** Stretched over the whole screen; never moves. */
  | { kind: "screen"; tile: HTMLCanvasElement }
  /** Wraps horizontally, hangs from the top of the screen and drifts sideways by itself. */
  | { kind: "ribbon"; tile: HTMLCanvasElement; width: number; height: number; top: number; depth: number; drift: number };

type Built = { key: string; layers: Layer[] };
type Builder = { key: (w: number, h: number) => string; build: (w: number, h: number, scale?: number) => Layer[] };

const TAU = Math.PI * 2;
const mod = (v: number, m: number) => ((v % m) + m) % m;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const bucket = (v: number, step: number) => Math.max(step, Math.ceil(v / step) * step);

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Smooth noise that repeats every `P` CSS px in both directions: a handful of plane waves with
 * whole-number frequencies. Returns roughly -0.5..0.5.
 */
function waves(seed: number, count: number, maxK: number) {
  const r = rng(seed);
  const terms = Array.from({ length: count }, () => {
    let a = 0, b = 0;
    while (!a && !b) {
      a = Math.round((r() * 2 - 1) * maxK);
      b = Math.round((r() * 2 - 1) * maxK);
    }
    return { a, b, ph: r() * TAU, w: 1 / Math.hypot(a, b) };
  });
  const total = terms.reduce((s, t) => s + t.w, 0);
  return (x: number, y: number, P: number) => {
    let s = 0;
    for (const t of terms) s += t.w * Math.sin((TAU * (t.a * x + t.b * y)) / P + t.ph);
    return s / total;
  };
}

/**
 * Paints a tile of `cw`×`ch` CSS px at `scale` device px per CSS px. `fn` receives CSS-px coordinates
 * and writes the light to add (0–255 per channel) into `out`. (No dithering: random pixels turn into a
 * visible grid once the tile is scaled up; the GPU's smooth scaling hides banding well enough.)
 */
function paint(cw: number, ch: number, scale: number, fn: (x: number, y: number, out: number[]) => void) {
  const W = Math.max(1, Math.round(cw * scale));
  const H = Math.max(1, Math.round(ch * scale));
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const img = g.createImageData(W, H);
  const d = img.data;
  const out = [0, 0, 0];
  const sx = cw / W, sy = ch / H;
  for (let j = 0; j < H; j++) {
    const y = (j + 0.5) * sy;
    for (let i = 0; i < W; i++) {
      out[0] = out[1] = out[2] = 0;
      fn((i + 0.5) * sx, y, out);
      const k = (j * W + i) * 4;
      d[k] = Math.min(255, Math.round(out[0]));
      d[k + 1] = Math.min(255, Math.round(out[1]));
      d[k + 2] = Math.min(255, Math.round(out[2]));
      d[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Period for tiles that wrap: about twice the longer screen side, so only one band or cloud group shows at a time. */
const periodFor = (w: number, h: number) => bucket(2 * Math.max(w, h), 256);

/* ---------------- Milky Way: a soft diagonal band with dust and fine stars ---------------- */

const milkyWay: Builder = {
  key: (w, h) => `${periodFor(w, h)}`,
  build(w, h, scale) {
    const P = periodFor(w, h);
    const s = scale ?? Math.min(0.35, 900 / P);
    const sig = P * 0.045;
    const spacing = P / Math.SQRT2;
    const along = waves(11, 7, 5);
    const wobble = waves(12, 5, 3);
    const lane = waves(13, 7, 7);
    const offset = (x: number, y: number) => wobble(x, y, P) * sig * 1.1;
    // The band runs along x + y ≡ 0 (mod P): a 45° line that closes on itself when the tile repeats.
    const signed = (x: number, y: number) => {
      const u = mod((x + y) / P, 1);
      return (u < 0.5 ? u : u - 1) * spacing;
    };
    const tile = paint(P, P, s, (x, y, o) => {
      const sd = signed(x, y);
      const d = sd - offset(x, y);
      const v = clamp(0.62 + 1.1 * along(x, y, P), 0.12, 1.25);
      const core = Math.exp(-(d * d) / (2 * sig * sig)) * v;
      const halo = Math.exp(-(sd * sd) / (2 * (2.8 * sig) ** 2));
      const dl = d - 0.3 * sig;
      const dust = 1 - 0.55 * Math.exp(-(dl * dl) / (2 * (0.26 * sig) ** 2)) * clamp(0.55 + 1.6 * lane(x, y, P), 0, 1);
      const c = core * dust;
      o[0] = c * 19 + halo * 6;
      o[1] = c * 18 + halo * 7;
      o[2] = c * 24 + halo * 13;
    });
    // Denser tiny stars along the band, in a sharper tile of their own (dots only, so it's cheap to paint).
    const ks = scale ?? Math.min(1, 2048 / P);
    const stars = document.createElement("canvas");
    stars.width = stars.height = Math.round(P * ks);
    const g = stars.getContext("2d")!;
    g.fillStyle = "#000";
    g.fillRect(0, 0, stars.width, stars.height);
    const k = stars.width / P;
    const r = rng(17);
    const gauss = () => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(TAU * r());
    const count = Math.round(P * Math.SQRT2 * sig * 2.4 * 0.0032);
    for (let i = 0; i < count; i++) {
      const t = r() * P;
      const off = gauss() * sig * (i % 3 === 0 ? 1.9 : 1);
      let x = t + off / Math.SQRT2;
      let y = -t + off / Math.SQRT2;
      const wob = offset(mod(x, P), mod(y, P));
      x = mod(x + wob / Math.SQRT2, P);
      y = mod(y + wob / Math.SQRT2, P);
      const tone = r();
      g.fillStyle = tone < 0.25 ? "#d9e3ff" : tone < 0.4 ? "#fff0dc" : "#ffffff";
      g.globalAlpha = (i % 3 === 0 ? 0.14 : 0.2) + r() * 0.36;
      g.beginPath();
      g.arc(x * k, y * k, (r() < 0.08 ? 0.75 : 0.5) * Math.max(1, k * 1.1), 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
    return [
      { kind: "torus", tile, size: P, depth: 0.22 },
      { kind: "torus", tile: stars, size: P, depth: 0.22 },
    ];
  },
};

/* ---------------- Purple nebula: a few large, very soft clouds ---------------- */

const CLOUDS = [
  { fx: 0.1, fy: -0.08, r: 0.15, c: [150, 70, 225], a: 0.13 },
  { fx: -0.15, fy: 0.17, r: 0.13, c: [105, 70, 235], a: 0.12 },
  { fx: 0.38, fy: 0.33, r: 0.16, c: [168, 74, 206], a: 0.1 },
  { fx: -0.36, fy: -0.3, r: 0.14, c: [96, 66, 216], a: 0.11 },
  { fx: 0.27, fy: -0.42, r: 0.11, c: [140, 82, 232], a: 0.09 },
] as const;

const nebula: Builder = {
  key: (w, h) => `${periodFor(w, h)}`,
  build(w, h, scale) {
    const P = periodFor(w, h);
    const s = scale ?? Math.min(0.4, 1100 / P);
    const warp = waves(21, 8, 6);
    const wisp = waves(22, 9, 9);
    const tile = paint(P, P, s, (x, y, o) => {
      const wv = warp(x, y, P);
      const fv = clamp(0.8 + 1.1 * wisp(x, y, P), 0.35, 1.25);
      for (const b of CLOUDS) {
        const dx = mod(x - b.fx * P + P / 2, P) - P / 2;
        const dy = mod(y - b.fy * P + P / 2, P) - P / 2;
        const R = b.r * P;
        const k = Math.exp(-((dx * dx + dy * dy) / (R * R)) * (1 + 1.6 * wv)) * fv * b.a;
        o[0] += b.c[0] * k;
        o[1] += b.c[1] * k;
        o[2] += b.c[2] * k;
      }
    });
    return [{ kind: "torus", tile, size: P, depth: 0.2 }];
  },
};

/* ---------------- Midnight blue: navy, lighter toward a faint horizon ---------------- */

let midnightTile: HTMLCanvasElement | null = null;
const midnight: Builder = {
  key: () => "screen",
  build() {
    // Resolution-independent: a small gradient stretched over the screen.
    midnightTile ??= paint(120, 300, 1, (x, y, o) => {
      const v = y / 300;
      const g = Math.pow(v, 1.7);
      const cx = (x / 120 - 0.5) * 2;
      const hz = Math.exp(-(((1 - v) / 0.14) ** 2)) * (1 - 0.35 * cx * cx);
      o[0] = g * 7 + hz * 9;
      o[1] = g * 12 + hz * 15;
      o[2] = g * 25 + hz * 28;
    });
    return [{ kind: "screen", tile: midnightTile }];
  },
};

/* ---------------- Aurora: two faint curtains near the top ---------------- */

const AURORA_TOP = 90;
const aurora: Builder = {
  key: (w, h) => `${periodFor(w, h)}x${bucket(h, 64)}`,
  build(w, h, scale) {
    const Pw = periodFor(w, h);
    const H0 = bucket(h, 64);
    const M = AURORA_TOP;
    const Hr = Math.round(H0 * 0.6) + M;
    const s = scale ?? Math.min(0.4, 1100 / Pw);
    const ribbon = (seed: number, y0: number, col: readonly [number, number, number], amp: number, drift: number): Layer => {
      const r = rng(seed);
      const ph = Array.from({ length: 8 }, () => r() * TAU);
      const k1 = Math.max(9, Math.round(Pw / 41));
      const k2 = Math.max(5, Math.round(Pw / 67)) + 1;
      const k3 = Math.max(3, Math.round(Pw / 150));
      const lower = 0.028 * H0 + 8;
      const upper = 0.1 * H0 + 12;
      const tile = paint(Pw, Hr, s, (x, y, o) => {
        const X = (TAU * x) / Pw;
        const c = M + H0 * (y0 + 0.03 * Math.sin(X + ph[0]!) + 0.018 * Math.sin(3 * X + ph[1]!) + 0.008 * Math.sin(7 * X + ph[2]!));
        const dy = y - c;
        // Faint, uneven vertical rays above the lower edge, like a curtain.
        const rays = clamp(0.55 + 0.2 * Math.sin(k1 * X + ph[3]!) + 0.15 * Math.sin(k2 * X + ph[4]!) + 0.15 * Math.sin(k3 * X + ph[6]!), 0, 1);
        const up = -dy / upper;
        let k = dy > 0 ? Math.exp(-((dy / lower) ** 2)) : Math.exp(-(up * up)) * (1 - (1 - rays) * Math.min(1, up * 1.5));
        k *= 0.3 + 0.7 * Math.pow(0.5 + 0.5 * Math.sin(2 * X + ph[5]!), 1.4);
        k *= clamp(y / M, 0, 1); // fade out before the tile's top edge
        o[0] = col[0] * amp * k;
        o[1] = col[1] * amp * k;
        o[2] = col[2] * amp * k;
      });
      return { kind: "ribbon", tile, width: Pw, height: Hr, top: M, depth: 0.18, drift };
    };
    return [
      ribbon(31, 0.12, [70, 230, 165], 0.15, 2.4),
      ribbon(32, 0.21, [150, 100, 240], 0.12, -1.5),
    ];
  },
};

const BUILDERS: Record<SkyTheme, Builder | null> = {
  black: null,
  "milky-way": milkyWay,
  nebula,
  midnight,
  aurora,
};

const BASE: Record<SkyTheme, string> = {
  black: "#000000",
  "milky-way": "rgb(2,2,5)",
  nebula: "rgb(5,3,13)",
  midnight: "rgb(3,6,20)",
  aurora: "rgb(1,3,7)",
};

export class Backdrop {
  private built: Built | null = null;
  /** Vertical sway of the top-hung layers: pushed by panning, eases back to rest. */
  private sway = 0;
  private prevOffY: number | null = null;
  private prevT = 0;

  /** `scale` overrides the tile resolution (used for thumbnails). */
  constructor(readonly theme: SkyTheme, private scale?: number) {}

  private layers(w: number, h: number) {
    const b = BUILDERS[this.theme];
    if (!b) return [];
    const key = b.key(w, h);
    if (this.built?.key !== key) this.built = { key, layers: b.build(w, h, this.scale) };
    return this.built.layers;
  }

  /**
   * Paints the backdrop over the whole canvas. `offX`/`offY` are the accumulated screen-space pan in
   * CSS px (the same numbers the starfield uses); `t` is seconds. `still` holds every layer in place.
   */
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number, offX: number, offY: number, t: number, alpha: number, still: boolean) {
    if (w <= 0 || h <= 0 || alpha <= 0) return;
    const layers = this.layers(w, h);
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = BASE[this.theme];
    ctx.fillRect(0, 0, w, h);
    if (layers.length) {
      const dt = clamp(t - this.prevT, 0, 0.1);
      this.prevT = t;
      if (still) this.sway = 0;
      else {
        if (this.prevOffY != null) this.sway -= (offY - this.prevOffY) * 0.18;
        this.sway = clamp(this.sway * Math.exp(-dt / 1.4), -45, 45);
      }
      this.prevOffY = offY;
      const snap = (v: number) => Math.round(v * dpr) / dpr;
      ctx.globalCompositeOperation = "lighter";
      for (const L of layers) {
        if (L.kind === "screen") {
          ctx.drawImage(L.tile, 0, 0, w, h);
        } else if (L.kind === "torus") {
          const S = L.size;
          const ox = snap(mod(w / 2 - (still ? 0 : offX * L.depth), S));
          const oy = snap(mod(h / 2 - (still ? 0 : offY * L.depth), S));
          for (const x of [ox - S, ox]) {
            if (x >= w || x + S <= 0) continue;
            for (const y of [oy - S, oy]) if (y < h && y + S > 0) ctx.drawImage(L.tile, x, y, S, S);
          }
        } else {
          const ox = snap(mod(w / 2 - (still ? 0 : offX * L.depth + t * L.drift), L.width));
          const y = snap(-L.top + this.sway);
          for (const x of [ox - L.width, ox]) if (x < w && x + L.width > 0) ctx.drawImage(L.tile, x, y, L.width, L.height);
        }
      }
    }
    ctx.restore();
  }
}

const shared = new Map<SkyTheme, Backdrop>();
/** One backdrop per theme, shared by every sky canvas so tiles are painted once. */
export function backdropFor(theme: SkyTheme) {
  let b = shared.get(theme);
  if (!b) shared.set(theme, (b = new Backdrop(theme)));
  return b;
}

const reduceMotion = typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
/** With "reduce motion" on, the theme layers stay still (no drift, no parallax). */
export const skyShouldBeStill = () => !!reduceMotion?.matches;

const thumbs = new Map<SkyTheme, string>();
/** A small portrait preview of a theme with a sprinkle of stars, as an image URL. */
export function skyThumb(theme: SkyTheme) {
  const hit = thumbs.get(theme);
  if (hit) return hit;
  const vw = 300, vh = 405, k = 0.4; // a phone-shaped sky drawn at 120×162 px
  const c = document.createElement("canvas");
  c.width = Math.round(vw * k);
  c.height = Math.round(vh * k);
  const ctx = c.getContext("2d")!;
  new Backdrop(theme, k).draw(ctx, vw, vh, k, 0, 0, 0, 1, true);
  const r = rng(7);
  for (let i = 0; i < 26; i++) {
    ctx.globalAlpha = 0.25 + r() * 0.5;
    ctx.fillStyle = r() < 0.3 ? "#d4e0ff" : "#ffffff";
    const s = r() < 0.15 ? 2 : 1;
    ctx.fillRect(Math.round(r() * c.width), Math.round(r() * c.height), s, s);
  }
  const url = c.toDataURL("image/png");
  thumbs.set(theme, url);
  return url;
}
