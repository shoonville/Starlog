import { format } from "date-fns";
import type { Connection, Constellation, Star } from "@workspace/api-client-react";

export const DEFAULT_STAR = "#FFE2AE";

export const PALETTE: { name: string; hex: string }[] = [
  { name: "Blue", hex: "#4D8DFF" },
  { name: "Violet", hex: "#A06BFF" },
  { name: "Pink", hex: "#FF5C9E" },
  { name: "Gold", hex: "#FFC23D" },
  { name: "Green", hex: "#34D399" },
  { name: "Orange", hex: "#FF8A4C" },
  { name: "Teal", hex: "#22D3D3" },
  { name: "Magenta", hex: "#E36BFF" },
  { name: "Moonlight", hex: "#D6DEFF" },
];

/** Mix a hex color toward white; returns [r,g,b]. */
export function lighten(hex: string, amount: number): [number, number, number] {
  const [r, g, b] = hexToRgb(hex);
  const up = (c: number) => Math.round(c + (255 - c) * amount);
  return [up(r), up(g), up(b)];
}

/** Tint for a constellation name: its most common star color, lifted toward white (as drawn on the sky). */
export function constellationTint(colors: string[]): [number, number, number] {
  const tally = new Map<string, number>();
  for (const c of colors) tally.set(c, (tally.get(c) ?? 0) + 1);
  let best = DEFAULT_STAR, bestN = 0;
  for (const [col, k] of tally) if (k > bestN) { best = col; bestN = k; }
  return lighten(best, 0.45);
}

export const MIN_ZOOM = 0.22;
export const MAX_ZOOM = 3.6;

export function starRadius(noteCount: number) {
  return Math.min(4.2 + 3.3 * Math.log2(1 + Math.max(0, noteCount)), 17);
}

/** The label color lifted slightly toward white (used for small swatches so they read as bright as the stars). */
export function brighten(hex: string, amount = 0.16) {
  const [r, g, b] = hexToRgb(hex);
  const up = (c: number) => Math.round(c + (255 - c) * amount);
  return `rgb(${up(r)}, ${up(g)}, ${up(b)})`;
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  if (Number.isNaN(n)) return [244, 228, 196];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function formatStamp(iso: string) {
  return format(new Date(iso), "MMM d, yyyy · h:mm a");
}

/** Like formatStamp, but leaves out the year when it's the current one ("Nov 19 · 9:21 AM"). */
export function formatStampShort(iso: string) {
  const d = new Date(iso);
  return format(d, d.getFullYear() === new Date().getFullYear() ? "MMM d · h:mm a" : "MMM d, yyyy · h:mm a");
}

/** id -> root id of its connected component */
export function componentRoots(stars: Star[], connections: Connection[]) {
  const parent = new Map<number, number>();
  for (const s of stars) parent.set(s.id, s.id);
  const find = (x: number): number => {
    let r = x;
    while (parent.get(r) !== undefined && parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (c !== r) {
      const n = parent.get(c)!;
      parent.set(c, r);
      c = n;
    }
    return r;
  };
  for (const c of connections) {
    if (!parent.has(c.fromStarId) || !parent.has(c.toStarId)) continue;
    const a = find(c.fromStarId);
    const b = find(c.toStarId);
    if (a !== b) parent.set(a, b);
  }
  const roots = new Map<number, number>();
  for (const s of stars) roots.set(s.id, find(s.id));
  return roots;
}

export type ConstellationView = { id: number; name: string; members: number[] };

export function constellationViews(
  stars: Star[],
  connections: Connection[],
  constellations: Constellation[],
  roots: Map<number, number>,
): ConstellationView[] {
  const groups = new Map<number, number[]>();
  for (const s of stars) {
    const r = roots.get(s.id)!;
    const g = groups.get(r);
    if (g) g.push(s.id);
    else groups.set(r, [s.id]);
  }
  void connections;
  const out: ConstellationView[] = [];
  for (const c of constellations) {
    const r = roots.get(c.anchorStarId);
    if (r === undefined) continue;
    const members = groups.get(r) ?? [];
    if (members.length < 2) continue;
    out.push({ id: c.id, name: c.name, members });
  }
  return out;
}
