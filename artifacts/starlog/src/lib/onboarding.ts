import { useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetSkyQueryKey, useUpdatePreferences, type Sky, type TipId } from "@workspace/api-client-react";

/**
 * The welcome tour and one-time tips. Each is shown once per device or account: seen ids are kept
 * on this device, and signed-in accounts also save them to the account (the demo stays on-device).
 */

const KEY = "starlog:seen-tips";

function readLocal(): TipId[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

let local: TipId[] = typeof window === "undefined" ? [] : readLocal();
const listeners = new Set<() => void>();

function rememberLocally(id: TipId) {
  if (local.includes(id)) return;
  local = [...local, id];
  try {
    localStorage.setItem(KEY, JSON.stringify(local));
  } catch {
    /* private mode: it just may show again next time */
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useTips(sky: Sky) {
  const qc = useQueryClient();
  const save = useUpdatePreferences();
  const seenHere = useSyncExternalStore(subscribe, () => local, () => local);
  const seen = (id: TipId) => seenHere.includes(id) || (!sky.isDemo && sky.seenTips.includes(id));
  const markSeen = (id: TipId) => {
    rememberLocally(id);
    if (sky.isDemo || sky.seenTips.includes(id)) return;
    qc.setQueryData<Sky>(getGetSkyQueryKey(), (old) => (old && !old.seenTips.includes(id) ? { ...old, seenTips: [...old.seenTips, id] } : old));
    save.mutate({ data: { seenTips: [id] } });
  };
  return { seen, markSeen };
}
