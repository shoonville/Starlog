import { useEffect, useMemo, useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import type { Sky, Star } from "@workspace/api-client-react";
import { Plus, Sparkles, X } from "lucide-react";
import type { SkyActions } from "@/hooks/use-sky-actions";
import { draftKeys, useDraft } from "@/lib/save-safety";
import { INBOX_TITLE, REPEAT_LABEL, formatDue, parseQuickAdd, resolveDestination, todayStr, useToday } from "@/lib/tasks";

/**
 * One input for adding a task anywhere: "Call dentist Friday #Personal" shows
 * "Friday · Personal" before saving, then goes to the matching star (or Inbox).
 */
export function QuickAdd({
  sky, actions, ensureStar, createStarNamed, onAdded, onClose,
}: {
  sky: Sky;
  actions: SkyActions;
  ensureStar: (title: string, then: (s: Star) => void) => void;
  createStarNamed: (title: string, labelId: number | null, then: (s: Star) => void) => void;
  onAdded: (star: Star, title: string, isNew: boolean) => void;
  onClose: () => void;
}) {
  const [text, setText] = useDraft(draftKeys.quickAdd);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { const t = window.setTimeout(() => input.current?.focus(), 60); return () => clearTimeout(t); }, []);

  const parsed = useMemo(() => (text.trim() ? parseQuickAdd(text) : null), [text]);
  const dest = useMemo(() => resolveDestination(parsed?.tag ?? null, sky.stars, sky.labels), [parsed?.tag, sky.stars, sky.labels]);
  const title = parsed?.title || "";
  const today = useToday();

  const where =
    dest.kind === "star"
      ? dest.via === "label" ? dest.label!.name : dest.star.title
      : INBOX_TITLE;
  // Say "Friday" when the user typed Friday, even if that happens to be tomorrow.
  const dueLabel = parsed?.dueDate
    ? (() => {
        const f = formatDue(parsed.dueDate, today);
        return f === "Tomorrow" && !/\b(tom|tmr)/i.test(text) ? format(parseISO(parsed.dueDate), "EEEE") : f;
      })()
    : null;
  const preview = parsed
    ? [dueLabel, parsed.repeat && REPEAT_LABEL[parsed.repeat], parsed.priority === "high" && "High priority", where].filter(Boolean).join(" · ")
    : "";
  const detail =
    !parsed ? null
    : dest.kind === "star" && dest.via === "label" ? `Goes to ${dest.star.title}`
    : dest.kind === "inbox" && parsed.tag ? `No star called "${parsed.tag}" yet, so it goes to ${INBOX_TITLE}`
    : dest.kind === "inbox" && !dest.star ? `An ${INBOX_TITLE} star will appear for it`
    : null;

  const data = () => ({ title, dueDate: parsed!.dueDate, priority: parsed!.priority, repeat: parsed!.repeat });
  const done = (star: Star, isNew = false) => { setBusy(false); setText(""); onAdded(star, title, isNew); };

  const save = () => {
    if (!parsed || !title || busy) return;
    if (dest.kind === "star") {
      actions.addTask(dest.star.id, data());
      done(dest.star);
      return;
    }
    setBusy(true);
    ensureStar(INBOX_TITLE, (star) => { actions.addTask(star.id, data()); done(star); });
  };
  const saveToNewStar = () => {
    if (!parsed || !title || busy) return;
    setBusy(true);
    const labelId = parsed.tag ? sky.labels.find((l) => l.name.toLocaleLowerCase() === parsed.tag!.toLocaleLowerCase())?.id ?? null : null;
    const name = parsed.tag && labelId == null ? parsed.tag : title;
    createStarNamed(name, labelId, (star) => { actions.addTask(star.id, data()); done(star, true); });
  };

  return (
    <div className="sheet-panel rounded-[22px] p-3" data-testid="panel-quick-add">
      <form onSubmit={(e) => { e.preventDefault(); save(); }} className="flex items-center gap-2 rounded-2xl bg-white/[0.05] pl-4 pr-1.5 focus-within:bg-white/[0.07]">
        <Plus className="h-4 w-4 shrink-0 text-muted-foreground/70" />
        <input
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}
          maxLength={300}
          placeholder="Add a task, e.g. Call dentist Friday #Personal"
          enterKeyHint="done"
          className="quiet-input h-12 min-w-0 flex-1 text-[15px]"
          aria-label="New task"
          data-testid="input-quick-add"
        />
        <button type="button" onClick={onClose} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground" aria-label="Close" data-testid="button-close-quick-add">
          <X className="h-4 w-4" />
        </button>
      </form>
      {parsed && title && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-1 pt-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] text-foreground/90" data-testid="text-quick-add-preview">{preview}</div>
            {detail && <div className="truncate text-[11.5px] text-muted-foreground/70" data-testid="text-quick-add-detail">{detail}</div>}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={saveToNewStar}
              disabled={busy}
              className="flex h-11 items-center gap-1.5 rounded-full border border-white/10 px-3.5 text-[12.5px] text-muted-foreground hover:text-foreground disabled:opacity-40 md:h-9"
              data-testid="button-quick-add-new-star"
            >
              <Sparkles className="h-3.5 w-3.5" /> New star
            </button>
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="h-11 rounded-full bg-primary px-4 text-[13px] font-medium text-primary-foreground disabled:opacity-40 md:h-9"
              data-testid="button-quick-add-save"
            >
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
