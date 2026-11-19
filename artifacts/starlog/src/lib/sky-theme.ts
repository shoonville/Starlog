import { useSyncExternalStore } from "react";
import type { SkyTheme } from "@workspace/api-client-react";

export type { SkyTheme };

export const SKY_THEMES: { id: SkyTheme; name: string }[] = [
  { id: "black", name: "Black" },
  { id: "milky-way", name: "Milky Way" },
  { id: "nebula", name: "Purple nebula" },
  { id: "midnight", name: "Midnight blue" },
  { id: "aurora", name: "Aurora" },
];

const KEY = "starlog:sky-theme";
const isTheme = (v: unknown): v is SkyTheme => SKY_THEMES.some((t) => t.id === v);

function readLocal(): SkyTheme {
  try {
    const v = localStorage.getItem(KEY);
    return isTheme(v) ? v : "black";
  } catch {
    return "black";
  }
}

/**
 * The sky theme on screen. It is kept on this device too, so the landing and loading screens use the
 * last sky this device showed; signed-in accounts overwrite it with their saved choice.
 */
let current: SkyTheme = typeof window === "undefined" ? "black" : readLocal();
const listeners = new Set<() => void>();

function store(theme: SkyTheme) {
  current = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* private mode: the choice just isn't remembered on this device */
  }
}

export const getSkyTheme = () => current;

export function setSkyTheme(theme: SkyTheme) {
  if (theme === current) return;
  store(theme);
  listeners.forEach((l) => l());
}

/** Sets the theme without notifying (for use while rendering, before the sky canvas mounts). */
export function primeSkyTheme(theme: SkyTheme) {
  if (theme !== current) store(theme);
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useSkyTheme() {
  return useSyncExternalStore(subscribe, getSkyTheme, getSkyTheme);
}
