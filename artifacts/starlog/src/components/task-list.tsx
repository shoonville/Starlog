import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, Reorder, motion, useDragControls } from "framer-motion";
import type { Star, Task, TaskPriority, TaskRepeat } from "@workspace/api-client-react";
import { ArrowDownWideNarrow, Check, ChevronRight, Repeat2, Trash2, X } from "lucide-react";
import type { SkyActions } from "@/hooks/use-sky-actions";
import { REPEAT_LABEL, formatDue, isOverdue, orderedOpenTasks, parseQuickAdd, todayStr } from "@/lib/tasks";
import { hexToRgb } from "@/lib/sky";

export const PRIORITY_DOT = "#FF8A4C";
export const OVERDUE_TEXT = "text-[hsl(0_80%_76%)]";

/** Big round checkbox with a 44px tap area. */
export function TaskCheck({ done, color, onToggle, label }: { done: boolean; color: string; onToggle: () => void; label: string }) {
  const [r, g, b] = hexToRgb(color);
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={label}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      className="-m-2.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
      data-testid="checkbox-task"
    >
      <span
        className="flex h-[22px] w-[22px] items-center justify-center rounded-full border-[1.5px] transition-all duration-300 soft-ease"
        style={done ? { background: `rgba(${r},${g},${b},0.85)`, borderColor: "transparent" } : { borderColor: `rgba(${r},${g},${b},0.55)` }}
      >
        {done && <Check className="h-3.5 w-3.5 text-black" strokeWidth={3} />}
      </span>
    </button>
  );
}

/** Small meta line pieces: due date (soft red when overdue), repeat mark, priority dot. */
export function TaskMeta({ task, today }: { task: Task; today: string }) {
  const overdue = isOverdue(task, today);
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-[11.5px] tabular-nums">
      {task.priority === "high" && <span className="h-1.5 w-1.5 rounded-full" style={{ background: PRIORITY_DOT }} aria-label="High priority" title="High priority" />}
      {task.repeat && <Repeat2 className="h-3 w-3 text-muted-foreground/70" aria-label={`Repeats ${task.repeat}`} />}
      {task.dueDate && (
        <span className={overdue ? OVERDUE_TEXT : "text-muted-foreground/75"} data-testid={`text-task-due-${task.id}`}>
          {formatDue(task.dueDate, today)}
        </span>
      )}
    </span>
  );
}

function Segmented<T extends string | null>({ value, options, onChange, testId }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; testId: string }) {
  return (
    <div className="flex rounded-full bg-white/[0.05] p-0.5" data-testid={testId}>
      {options.map(([v, label]) => (
        <button
          key={String(v)}
          type="button"
          onClick={() => onChange(v)}
          className={`min-h-9 flex-1 rounded-full px-2 text-[12px] transition-colors duration-300 max-md:min-h-11 ${value === v ? "bg-white/[0.12] text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function TaskDetails({ task, actions, onClose }: { task: Task; actions: SkyActions; onClose: () => void }) {
  const [title, setTitle] = useState(task.title);
  useEffect(() => setTitle(task.title), [task.title]);
  const saveTitle = () => {
    const t = title.trim();
    if (t && t !== task.title) actions.editTask(task.id, { title: t });
    else setTitle(task.title);
  };
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="overflow-hidden"
    >
      <div className="mb-2 mt-1 space-y-3 rounded-2xl border border-white/[0.07] bg-[#111114] p-3.5" data-testid={`task-details-${task.id}`}>
        <input
          value={title}
          maxLength={300}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          aria-label="Task title"
          className="quiet-input w-full border-b border-white/10 pb-1.5 text-[14px]"
          data-testid="input-task-title"
        />
        <label className="flex items-center gap-3 text-[12px] text-muted-foreground">
          <span className="w-14 shrink-0">Due</span>
          <input
            type="date"
            value={task.dueDate ?? ""}
            onChange={(e) => actions.editTask(task.id, { dueDate: e.target.value || null })}
            className="min-h-9 flex-1 rounded-lg bg-white/[0.05] px-2.5 text-[13px] text-foreground [color-scheme:dark] max-md:min-h-11"
            data-testid="input-task-due"
          />
          {task.dueDate && (
            <button type="button" onClick={() => actions.editTask(task.id, { dueDate: null })} className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:text-foreground max-md:h-11 max-md:w-11" aria-label="Clear due date">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </label>
        <div className="flex items-center gap-3 text-[12px] text-muted-foreground">
          <span className="w-14 shrink-0">Priority</span>
          <div className="flex-1">
            <Segmented value={task.priority} options={[["low", "Low"], ["normal", "Normal"], ["high", "High"]]} onChange={(v: TaskPriority) => actions.editTask(task.id, { priority: v })} testId="segmented-priority" />
          </div>
        </div>
        <div className="flex items-center gap-3 text-[12px] text-muted-foreground">
          <span className="w-14 shrink-0">Repeat</span>
          <div className="flex-1">
            <Segmented value={task.repeat} options={[[null as TaskRepeat, "Never"], ["daily", "Daily"], ["weekly", "Weekly"], ["monthly", "Monthly"]]} onChange={(v) => actions.editTask(task.id, { repeat: v })} testId="segmented-repeat" />
          </div>
        </div>
        <div className="flex items-center justify-between pt-0.5">
          <button
            type="button"
            onClick={() => { actions.removeTask(task.id); onClose(); }}
            className="flex min-h-9 items-center gap-1.5 text-[12px] text-muted-foreground hover:text-[hsl(350_62%_74%)] max-md:min-h-11"
            data-testid="button-delete-task"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
          <button type="button" onClick={onClose} className="min-h-9 px-2 text-[12px] text-muted-foreground hover:text-foreground max-md:min-h-11">Done</button>
        </div>
      </div>
    </motion.div>
  );
}

const HOLD_MS = 500;

function TaskRow({
  task, color, today, open, onOpen, actions, onDragStart, onDragEnd, touchOnly,
}: {
  task: Task; color: string; today: string; open: boolean; onOpen: () => void; actions: SkyActions;
  onDragStart: () => void; onDragEnd: () => void; touchOnly: boolean;
}) {
  const controls = useDragControls();
  const hold = useRef<{ timer: number; x: number; y: number } | null>(null);
  const dragged = useRef(false);
  const [lifted, setLifted] = useState(false);

  const cancelHold = () => {
    if (hold.current) window.clearTimeout(hold.current.timer);
    hold.current = null;
  };
  useEffect(() => cancelHold, []);

  return (
    <Reorder.Item
      value={task}
      dragListener={false}
      dragControls={controls}
      onDragStart={() => { dragged.current = true; setLifted(true); onDragStart(); }}
      onDragEnd={() => { setLifted(false); onDragEnd(); window.setTimeout(() => { dragged.current = false; }, 50); }}
      className="relative list-none"
      style={{ zIndex: lifted ? 5 : 0 }}
      data-testid={`task-${task.id}`}
    >
      <div
        onPointerDown={(e) => {
          if (open || task.id < 0) return;
          if (e.pointerType === "mouse") {
            if (!touchOnly && e.button === 0) controls.start(e);
            return;
          }
          const ev = e.nativeEvent;
          cancelHold();
          hold.current = {
            x: e.clientX, y: e.clientY,
            timer: window.setTimeout(() => {
              hold.current = null;
              navigator.vibrate?.(8);
              controls.start(ev);
            }, HOLD_MS),
          };
        }}
        onPointerMove={(e) => {
          if (hold.current && Math.hypot(e.clientX - hold.current.x, e.clientY - hold.current.y) > 8) cancelHold();
        }}
        onPointerUp={cancelHold}
        onPointerCancel={cancelHold}
        onContextMenu={(e) => e.preventDefault()}
        onClick={() => { if (!dragged.current) onOpen(); }}
        className={`flex min-h-12 cursor-pointer select-none items-center gap-3 rounded-xl px-1.5 transition-[background-color,box-shadow] duration-300 ${lifted ? "bg-[#1a1a1f] shadow-[0_12px_30px_-12px_rgba(0,0,0,0.9)]" : open ? "bg-white/[0.04]" : "hover:bg-white/[0.035]"}`}
        style={{ WebkitTouchCallout: "none" }}
      >
        <TaskCheck done={task.done} color={color} label={task.done ? `Mark "${task.title}" not done` : `Complete "${task.title}"`} onToggle={() => actions.editTask(task.id, { done: !task.done })} />
        <span className={`min-w-0 flex-1 truncate text-[14px] ${task.done ? "text-muted-foreground/60 line-through decoration-white/20" : "text-foreground/90"}`} data-testid={`text-task-title-${task.id}`}>
          {task.title}
        </span>
        <TaskMeta task={task} today={today} />
      </div>
      <AnimatePresence initial={false}>
        {open && <TaskDetails task={task} actions={actions} onClose={onOpen} />}
      </AnimatePresence>
    </Reorder.Item>
  );
}

/** Blocks page scrolling while a task is being dragged on a touch screen. */
function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const stop = (e: TouchEvent) => e.preventDefault();
    document.addEventListener("touchmove", stop, { passive: false });
    return () => document.removeEventListener("touchmove", stop);
  }, [active]);
}

export function TaskList({
  star, tasks, color, actions, narrow, openTaskId, onOpenTask,
}: {
  star: Star; tasks: Task[]; color: string; actions: SkyActions; narrow: boolean;
  openTaskId: number | null; onOpenTask: (id: number | null) => void;
}) {
  const today = todayStr();
  const sorted = useMemo(() => orderedOpenTasks(tasks, star.taskOrder), [tasks, star.taskOrder]);
  const done = useMemo(() => tasks.filter((t) => t.done).sort((a, b) => ((b.doneAt ?? "") > (a.doneAt ?? "") ? 1 : -1)), [tasks]);
  const [order, setOrder] = useState(sorted);
  const [dragging, setDragging] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);
  useScrollLock(dragging);

  // Follow outside changes (new tasks, edits, check-offs) unless a drag is in progress.
  useEffect(() => { if (!dragging) setOrder(sorted); }, [sorted]); // eslint-disable-line react-hooks/exhaustive-deps

  const commitOrder = () => {
    setDragging(false);
    const ids = order.map((t) => t.id);
    if (ids.join(",") === sorted.map((t) => t.id).join(",")) return;
    actions.orderTasks(star.id, [...ids, ...done.map((t) => t.id)]);
  };

  if (tasks.length === 0) {
    return <p className="text-[13.5px] leading-relaxed text-muted-foreground/90">No tasks here yet. Add one below; a date like "Friday" works too.</p>;
  }

  return (
    <div data-testid="task-list">
      {star.taskOrder === "manual" && sorted.length > 1 && (
        <div className="-mt-1 mb-1 flex justify-end">
          <button
            onClick={() => actions.orderTasks(star.id, null)}
            className="flex min-h-9 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] text-muted-foreground hover:text-foreground max-md:min-h-11"
            data-testid="button-sort-by-date"
          >
            <ArrowDownWideNarrow className="h-3.5 w-3.5" /> Sort by date
          </button>
        </div>
      )}
      {order.length === 0 && <p className="py-2 text-[13px] text-muted-foreground/80">Everything here is done.</p>}
      <Reorder.Group axis="y" values={order} onReorder={setOrder} className="space-y-0.5">
        {order.map((t) => (
          <TaskRow
            key={t.id}
            task={t}
            color={color}
            today={today}
            open={openTaskId === t.id}
            onOpen={() => onOpenTask(openTaskId === t.id ? null : t.id)}
            actions={actions}
            onDragStart={() => { setDragging(true); onOpenTask(null); }}
            onDragEnd={commitOrder}
            touchOnly={false}
          />
        ))}
      </Reorder.Group>
      {!narrow && sorted.length > 1 && star.taskOrder !== "manual" && (
        <p className="mt-2 px-1.5 text-[11px] text-muted-foreground/45">Drag a task to set your own order.</p>
      )}
      {narrow && sorted.length > 1 && star.taskOrder !== "manual" && (
        <p className="mt-2 px-1.5 text-[11px] text-muted-foreground/45">Press and hold a task to move it.</p>
      )}
      {done.length > 0 && (
        <div className="mt-3 border-t border-white/[0.05] pt-2">
          <button
            onClick={() => setDoneOpen((v) => !v)}
            className="flex min-h-11 w-full items-center gap-2 rounded-xl px-1.5 text-[12.5px] text-muted-foreground hover:text-foreground"
            aria-expanded={doneOpen}
            data-testid="button-done-toggle"
          >
            <ChevronRight className={`h-3.5 w-3.5 transition-transform duration-300 ${doneOpen ? "rotate-90" : ""}`} />
            Done ({done.length})
          </button>
          <AnimatePresence initial={false}>
            {doneOpen && (
              <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                {done.map((t) => (
                  <li key={t.id} className="flex min-h-11 items-center gap-3 px-1.5" data-testid={`task-done-${t.id}`}>
                    <TaskCheck done color={color} label={`Mark "${t.title}" not done`} onToggle={() => actions.editTask(t.id, { done: false })} />
                    <span className="min-w-0 flex-1 truncate text-[13.5px] text-muted-foreground/60 line-through decoration-white/20">{t.title}</span>
                    {t.repeat && <Repeat2 className="h-3 w-3 text-muted-foreground/50" />}
                  </li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

/** One-line task input at the bottom of the Tasks tab. Understands dates like "Friday" or "tomorrow". */
export function TaskComposer({ starId, actions }: { starId: number; actions: SkyActions }) {
  const [text, setText] = useState("");
  const parsed = useMemo(() => (text.trim() ? parseQuickAdd(text) : null), [text]);
  const today = todayStr();
  const submit = () => {
    if (!parsed) return;
    const title = (parsed.title || text.trim()) + (parsed.tag ? ` #${parsed.tag}` : "");
    if (!title.trim()) return;
    actions.addTask(starId, { title, dueDate: parsed.dueDate, priority: parsed.priority, repeat: parsed.repeat });
    setText("");
  };
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); submit(); }}
      className="flex items-center gap-2 rounded-2xl bg-white/[0.045] py-1.5 pl-4 pr-1.5 transition-colors duration-500 focus-within:bg-white/[0.07]"
    >
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={300}
        placeholder="Add a task..."
        enterKeyHint="done"
        className="quiet-input min-h-9 min-w-0 flex-1 text-[14px] max-md:min-h-11"
        data-testid="input-new-task"
      />
      {parsed && (parsed.dueDate || parsed.repeat || parsed.priority === "high") && (
        <span className="shrink-0 text-[11.5px] text-muted-foreground" data-testid="text-new-task-preview">
          {[parsed.dueDate && formatDue(parsed.dueDate, today), parsed.repeat && REPEAT_LABEL[parsed.repeat], parsed.priority === "high" && "High"].filter(Boolean).join(" · ")}
        </span>
      )}
      <button
        type="submit"
        disabled={!text.trim()}
        className="h-9 shrink-0 rounded-full bg-primary px-3.5 text-[12.5px] font-medium text-primary-foreground disabled:opacity-30 max-md:h-11"
        data-testid="button-add-task"
      >
        Add
      </button>
    </form>
  );
}
