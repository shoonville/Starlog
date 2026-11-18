import { format } from "date-fns";
import type { Connection, Constellation, Star } from "@workspace/api-client-react";

export const DEFAULT_STAR = "#F4E4C4";

export const PALETTE: { name: string; hex: string }[] = [
  { name: "Moonwater", hex: "#9DB8E8" },
  { name: "Lavender", hex: "#B9A6F0" },
  { name: "Rosewood", hex: "#EBA9C0" },
  { name: "Honey", hex: "#EBC98A" },
  { name: "Sage", hex: "#A9CDB0" },
  { name: "Apricot", hex: "#F0B49A" },
  { name: "Tidepool", hex: "#8FCFCB" },
  { name: "Lilac", hex: "#D7B4E8" },
  { name: "Pearl", hex: "#E4DFF0" },
];

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
