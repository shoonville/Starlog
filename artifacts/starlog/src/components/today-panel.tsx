import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { format } from "date-fns";
import type { Sky, Star, Task } from "@workspace/api-client-react";
import { ChevronRight, X } from "lucide-react";
import type { SkyActions } from "@/hooks/use-sky-actions";
import { DEFAULT_STAR } from "@/lib/sky";
import { DAILY_LOG_TITLE, todayStr, useToday } from "@/lib/tasks";
import { draftKeys, useDraft } from "@/lib/save-safety";
import { TaskCheck, TaskMeta } from "@/components/task-list";

/** Open tasks due today or earlier. */
export function dueTasks(tasks: Task[], today = todayStr()) {
  return tasks.filter((t) => !t.done && t.dueDate != null && t.dueDate <= today && t.id > 0);
}

export function TodayPanel({
  sky, actions, onPickTask, onClose, ensureStar, handle, tip, onThisDay,
}: {
  sky: Sky;
  actions: SkyActions;
  onPickTask: (t: Task) => void;
  onClose: () => void;
  ensureStar: (title: string, then: (s: Star) => void) => void;
  /** Drag handle for the phone sheet. */
  handle?: React.ReactNode;
  /** A one-time tip shown under the header. */
  tip?: React.ReactNode;
  /** On This Day entry point, shown beside the date heading. */
  onThisDay?: React.ReactNode;
}) {
  const today = useToday();
  // Tasks checked off while the panel is open stay in view (struck through) until it closes.
  const [kept, setKept] = useState<Set<number>>(() => new Set());
  const shown = useMemo(
    () => sky.tasks.filter((t) => t.id > 0 && t.dueDate != null && t.dueDate <= today && (!t.done || kept.has(t.id))),
    [sky.tasks, today, kept],
  );
  const groups = useMemo(() => {
    const byStar = new Map<number, Task[]>();
    for (const t of shown) byStar.set(t.starId, [...(byStar.get(t.starId) ?? []), t]);
    const out: Array<{ star: Star; tasks: Task[] }> = [];
    for (const [id, tasks] of byStar) {
      const star = sky.stars.find((s) => s.id === id);
      if (!star) continue;
      tasks.sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : a.dueDate! > b.dueDate! ? 1 : a.id - b.id));
      out.push({ star, tasks });
    }
    return out.sort((a, b) => (a.tasks[0]!.dueDate! < b.tasks[0]!.dueDate! ? -1 : 1));
  }, [shown, sky.stars]);
  const colorOf = (s: Star) => (s.labelId == null ? DEFAULT_STAR : sky.labels.find((l) => l.id === s.labelId)?.color ?? DEFAULT_STAR);

  const [logOpen, setLogOpen] = useState(false);
  const [log, setLog] = useDraft(draftKeys.todayLog);
  const [saved, setSaved] = useState(false);
  const logRef = useRef<HTMLTextAreaElement>(null);
  const saveLog = () => {
    const body = log.trim();
    if (!body) return;
    ensureStar(DAILY_LOG_TITLE, (star) => {
      actions.addNote(star.id, body, () => {
        setLog("");
        setLogOpen(false);
        setSaved(true);
      });
    });
  };

  return (
    <div className="sheet-panel flex h-full max-h-full flex-col overflow-hidden rounded-[22px]" data-testid="panel-today">
      {handle}
      <div className="relative flex items-start gap-3 px-5 pb-2 pt-4 md:px-6 md:pt-5">
        {tip}
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-medium tracking-[-0.01em]">Today</h2>
          <p className="text-[12px] text-muted-foreground/80">{format(new Date(), "EEEE, MMMM d")}</p>
          {onThisDay}
        </div>
        <button onClick={onClose} className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:bg-white/5 hover:text-foreground md:h-9 md:w-9" aria-label="Close" data-testid="button-close-today">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-3 md:px-6">
        {groups.length === 0 ? (
          <div className="flex flex-col items-center py-10 text-center" data-testid="text-nothing-due">
            <span className="mb-4 h-1.5 w-1.5 rounded-full bg-[#ffe2ae] shadow-[0_0_16px_4px_rgba(255,226,174,0.25)]" />
            <p className="text-[14px] text-foreground/75">Nothing due today</p>
            <p className="mt-1 text-[12px] text-muted-foreground/70">A quiet sky. Enjoy it.</p>
          </div>
        ) : (
          <div className="space-y-4 pt-1">
            {groups.map(({ star, tasks }) => (
              <section key={star.id} data-testid={`today-group-${star.id}`}>
                <div className="mb-0.5 flex items-center gap-2 px-1 text-[11px] uppercase tracking-[0.1em] text-muted-foreground/75">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: colorOf(star), boxShadow: `0 0 6px ${colorOf(star)}` }} />
                  <span className="truncate">{star.title}</span>
                </div>
                <ul>
                  {tasks.map((t) => (
                    <li key={t.id}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => onPickTask(t)}
                        onKeyDown={(e) => { if (e.key === "Enter") onPickTask(t); }}
                        className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-1.5 hover:bg-white/[0.035]"
                        data-testid={`today-task-${t.id}`}
                      >
                        <TaskCheck
                          done={t.done}
                          color={colorOf(star)}
                          label={t.done ? `Mark "${t.title}" not done` : `Complete "${t.title}"`}
                          onToggle={() => {
                            setKept((k) => new Set(k).add(t.id));
                            actions.editTask(t.id, { done: !t.done });
                          }}
                        />
                        <span className={`min-w-0 flex-1 truncate text-[14px] ${t.done ? "text-muted-foreground/60 line-through decoration-white/20" : "text-foreground/90"}`}>{t.title}</span>
                        <TaskMeta task={t} today={today} />
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-white/[0.06] px-4 py-2">
        <button
          onClick={() => { setLogOpen((v) => !v); setSaved(false); window.setTimeout(() => logRef.current?.focus(), 80); }}
          className="flex min-h-11 w-full items-center gap-2 px-1 text-left text-[13px] text-muted-foreground hover:text-foreground"
          aria-expanded={logOpen}
          data-testid="button-daily-log"
        >
          <ChevronRight className={`h-3.5 w-3.5 transition-transform duration-300 ${logOpen ? "rotate-90" : ""}`} />
          {saved ? <span>Saved to {DAILY_LOG_TITLE}</span> : <span>How did today go?</span>}
        </button>
        <AnimatePresence initial={false}>
          {logOpen && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <div className="mb-1.5 rounded-2xl bg-white/[0.045] px-4 py-3 focus-within:bg-white/[0.07]">
                <textarea
                  ref={logRef}
                  value={log}
                  onChange={(e) => setLog(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveLog(); } }}
                  rows={3}
                  maxLength={4000}
                  placeholder="A line or two about today..."
                  className="quiet-input w-full resize-none text-[14px] leading-relaxed"
                  data-testid="input-daily-log"
                />
                <div className="flex items-center justify-between pt-1">
                  <span className="text-[11px] text-muted-foreground/60">Saved to your {DAILY_LOG_TITLE} star</span>
                  <button
                    onClick={saveLog}
                    disabled={!log.trim()}
                    className="h-9 rounded-full bg-primary px-3.5 text-[12.5px] font-medium text-primary-foreground disabled:opacity-30 max-md:h-11"
                    data-testid="button-save-daily-log"
                  >
                    Save
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
