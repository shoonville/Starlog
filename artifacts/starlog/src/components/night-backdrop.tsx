import { useEffect, useRef } from "react";
import { getSprite, Starfield } from "@/lib/starfield";
import { hexToRgb } from "@/lib/sky";
import { getSkyTheme, useSkyTheme } from "@/lib/sky-theme";

/** Decorative sky for landing / loading / error screens. Optionally draws a slow sample constellation. */
export function NightBackdrop({ constellation = false }: { constellation?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const field = useRef<Starfield | null>(null);
  const theme = useSkyTheme();
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    const bg = new Starfield(21);
    bg.setTheme(getSkyTheme(), true);
    field.current = bg;
    let raf = 0;
    const start = performance.now();
    // A wide, low constellation that spans the top of the screen
    const pts = [
      { x: 0.14, y: 0.27, r: 5, c: "#FFC23D" },
      { x: 0.33, y: 0.17, r: 3.5, c: "#A06BFF" },
      { x: 0.52, y: 0.28, r: 4.2, c: "#FF5C9E" },
      { x: 0.71, y: 0.2, r: 3.4, c: "#4D8DFF" },
      { x: 0.87, y: 0.31, r: 3, c: "#FFE2AE" },
      { x: 0.6, y: 0.4, r: 2.6, c: "#34D399" },
    ];
    const edges = [[0, 1], [1, 2], [2, 3], [3, 4], [2, 5]];
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = c.clientWidth, h = c.clientHeight;
      if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const t = now / 1000;
      const drift = (now - start) / 1000;
      bg.draw(ctx, w, h, dpr, t, drift * 4, drift * 1.5);
      if (!constellation) return;
      const narrow = w < 768;
      const P = pts.map((p) => ({ ...p, x: (0.5 + (p.x - 0.5) * (narrow ? 1 : 0.55)) * w, y: p.y * h }));
      const el = (now - start) / 1000;
      edges.forEach(([a, b], i) => {
        const prog = Math.max(0, Math.min(1, (el - 1.2 - i * 0.7) / 1.6));
        if (prog <= 0) return;
        const e = 1 - Math.pow(1 - prog, 3);
        const [r1, g1, b1] = hexToRgb(P[a].c), [r2, g2, b2] = hexToRgb(P[b].c);
        const grad = ctx.createLinearGradient(P[a].x, P[a].y, P[b].x, P[b].y);
        grad.addColorStop(0, `rgba(${r1},${g1},${b1},0.34)`);
        grad.addColorStop(1, `rgba(${r2},${g2},${b2},0.34)`);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(P[a].x, P[a].y);
        ctx.lineTo(P[a].x + (P[b].x - P[a].x) * e, P[a].y + (P[b].y - P[a].y) * e);
        ctx.stroke();
      });
      P.forEach((p, i) => {
        const prog = Math.max(0, Math.min(1, (el - 0.3 - i * 0.35) / 1.4));
        if (prog <= 0) return;
        const e = 1 - Math.pow(1 - prog, 3);
        const half = p.r * 4 * e * (0.95 + 0.05 * Math.sin(t * 0.8 + i));
        ctx.globalAlpha = e;
        ctx.drawImage(getSprite(p.c), p.x - half, p.y - half, half * 2, half * 2);
        ctx.globalAlpha = 1;
      });
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [constellation]);
  useEffect(() => field.current?.setTheme(theme), [theme]);
  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />;
}
