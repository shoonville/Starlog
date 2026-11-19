import { useEffect, useRef, useState } from "react";
import { ApiError } from "@workspace/api-client-react";

/**
 * Keeping the user's writing safe.
 *
 * - Saves that fail because the connection dropped (or the server hiccuped) are retried with a
 *   growing pause; while the device is offline they wait and go out as soon as it's back.
 * - Text being typed is mirrored to localStorage as a draft, and only cleared once the server has
 *   it, so a reload, a closed card or a failed save never loses it.
 */

const MAX_SERVER_RETRIES = 6;

function isConnectionError(err: unknown) {
  return !(err instanceof ApiError) && err instanceof TypeError;
}

export function shouldRetrySave(failures: number, err: unknown) {
  if (isConnectionError(err)) return true; // keep trying for as long as the page is open
  if (err instanceof ApiError) {
    const s = err.status;
    if (s === 408 || s === 502 || s === 503 || s === 504 || s === 500) return failures < MAX_SERVER_RETRIES;
  }
  return false;
}

export const saveRetryDelay = (failures: number) => Math.min(1000 * 2 ** failures, 20_000);

/* ---------------- drafts ---------------- */

const PREFIX = "starlog:draft:";

export const draftKeys = {
  note: (starId: number) => `note:${starId}`,
  noteEdit: (noteId: number) => `note-edit:${noteId}`,
  task: (starId: number) => `task:${starId}`,
  quickAdd: "quick-add",
  todayLog: "today-log",
};

export function readDraft(key: string): string {
  try {
    return localStorage.getItem(PREFIX + key) ?? "";
  } catch {
    return "";
  }
}

export function writeDraft(key: string, value: string) {
  try {
    if (value.trim()) localStorage.setItem(PREFIX + key, value);
    else localStorage.removeItem(PREFIX + key);
  } catch {
    /* storage full or private mode: the text still lives in the input */
  }
}

/** Clears a draft once the server has saved it (unless it has changed since it was sent). */
export function clearDraftIfSent(key: string, sent: string) {
  if (readDraft(key).trim() === sent.trim()) writeDraft(key, "");
}

/** Text state that is mirrored to a draft, so it survives reloads and closed panels. */
export function useDraft(key: string) {
  const [value, setValue] = useState(() => readDraft(key));
  const keyRef = useRef(key);
  // A different star: load its draft.
  useEffect(() => {
    if (keyRef.current === key) return;
    keyRef.current = key;
    setValue(readDraft(key));
  }, [key]);
  const set = (v: string | ((prev: string) => string)) => {
    setValue((prev) => {
      const next = typeof v === "function" ? v(prev) : v;
      writeDraft(keyRef.current, next);
      return next;
    });
  };
  return [value, set] as const;
}
