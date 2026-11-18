import { useEffect, useRef } from "react";
import { drawSkyBackground, getSprite, makeBgStars } from "@/lib/starfield";

/** Decorative sky for landing / loading / error screens. Optionally draws a slow sample constellation. */
export function NightBackdrop({ constellation = false }: { constellation?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    const bg = makeBgStars(320, 21);
    let raf = 0;
    const start = performance.now();
    const pts = [
      { x: 0.62, y: 0.3, r: 5, c: "#F4E4C4" },
      { x: 0.71, y: 0.22, r: 3.5, c: "#B9A6F0" },
      { x: 0.8, y: 0.34, r: 4.2, c: "#EBA9C0" },
      { x: 0.76, y: 0.48, r: 3, c: "#9DB8E8" },
      { x: 0.88, y: 0.44, r: 3.4, c: "#F4E4C4" },
      { x: 0.68, y: 0.6, r: 2.6, c: "#A9CDB0" },
    ];
    const edges = [[0, 1], [1, 2], [2, 3], [2, 4], [3, 5]];
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = c.clientWidth, h = c.clientHeight;
      if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const t = now / 1000;
      const drift = (now - start) / 1000;
      drawSkyBackground(ctx, w, h, t, bg, drift * 6, drift * 2);
      if (!constellation) return;
      const narrow = w < 768;
      const P = pts.map((p) => ({ ...p, x: (narrow ? p.x * 1.2 - 0.3 : p.x) * w, y: (narrow ? p.y * 0.55 + 0.02 : p.y) * h }));
      const el = (now - start) / 1000;
      edges.forEach(([a, b], i) => {
        const prog = Math.max(0, Math.min(1, (el - 1.2 - i * 0.7) / 1.6));
        if (prog <= 0) return;
        const e = 1 - Math.pow(1 - prog, 3);
        ctx.strokeStyle = "rgba(214,200,250,0.22)";
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
        const half = p.r * 5 * e * (0.95 + 0.05 * Math.sin(t * 0.8 + i));
        ctx.globalAlpha = e;
        ctx.drawImage(getSprite(p.c), p.x - half, p.y - half, half * 2, half * 2);
        ctx.globalAlpha = 1;
      });
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [constellation]);
  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />;
}
