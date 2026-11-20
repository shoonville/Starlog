import { toast } from "@/hooks/use-toast";
import { useSyncExternalStore } from "react";

/**
 * Deletions are held back for a few seconds so they can be undone. While an
 * item is pending, the UI hides it; when the timer runs out the real DELETE
 * request is sent. If the page is closed first, pending deletes are sent
 * immediately with keepalive requests.
 */

export const UNDO_MS = 5000;

export type PendingDelete = {
  key: string;
  kind: "star" | "note";
  id: number;
  /** For notes: the star the note belongs to. */
  starId?: number;
  label: string;
  startedAt: number;
};

type Entry = PendingDelete & { timer: number; onCommitted: () => void };

let entries: Entry[] = [];
let snapshot: PendingDelete[] = [];
const listeners = new Set<() => void>();

function emit() {
  snapshot = entries.map(({ timer: _t, onCommitted: _c, ...rest }) => rest);
  listeners.forEach((l) => l());
}

function send(e: Pick<Entry, "kind" | "id">) {
  const path = e.kind === "star" ? `stars/${e.id}` : `notes/${e.id}`;
  return fetch(`${import.meta.env.BASE_URL}api/${path}`, {
    method: "DELETE",
    credentials: "include",
    keepalive: true,
  });
}

function commit(key: string) {
  const e = entries.find((x) => x.key === key);
  if (!e) return;
  clearTimeout(e.timer);
  const done = () => {
    // Update the caches first, then stop hiding the item, so it never flickers back.
    e.onCommitted();
    entries = entries.filter((x) => x.key !== key);
    emit();
  };
  // A delete the server refused (or that never arrived) is undone visibly, never faked.
  const failed = () => {
    entries = entries.filter((x) => x.key !== key);
    emit();
    toast({ title: "Couldn't delete that", description: "It's back where it was. Try again in a moment." });
  };
  send(e).then((res) => (res.ok || res.status === 404 ? done() : failed()), failed);
}

export function scheduleDelete(
  item: Omit<PendingDelete, "key" | "startedAt">,
  onCommitted: () => void,
) {
  const key = `${item.kind}-${item.id}`;
  if (entries.some((x) => x.key === key)) return;
  const timer = window.setTimeout(() => commit(key), UNDO_MS);
  entries = [...entries, { ...item, key, startedAt: Date.now(), timer, onCommitted }];
  emit();
}

export function undoDelete(key?: string) {
  const target = key ?? entries[entries.length - 1]?.key;
  const e = entries.find((x) => x.key === target);
  if (!e) return false;
  clearTimeout(e.timer);
  entries = entries.filter((x) => x.key !== target);
  emit();
  return true;
}

/** Sends every pending delete right away (used when the page is closing). */
export function flushDeletes() {
  if (!entries.length) return;
  for (const e of entries) {
    clearTimeout(e.timer);
    void send(e);
    e.onCommitted();
  }
  entries = [];
  emit();
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushDeletes);
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function usePendingDeletes() {
  return useSyncExternalStore(subscribe, () => snapshot);
}
