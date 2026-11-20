import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarCheck2, NotebookPen, Sparkles, Waypoints } from "lucide-react";

const EASE = [0.22, 1, 0.36, 1] as const;

const STEPS: { icon: ReactNode; color: string; title: string; text: string }[] = [
  { icon: <Sparkles className="h-5 w-5" />, color: "#FFC23D", title: "Every star is something in your life", text: "A project, a goal, a habit. Tap + to light a new star." },
  { icon: <NotebookPen className="h-5 w-5" />, color: "#A06BFF", title: "Write and plan inside it", text: "Open a star to add notes and tasks. It grows as you write." },
  { icon: <Waypoints className="h-5 w-5" />, color: "#FF5C9E", title: "Connect stars into constellations", text: "Hold a star, then tap another to link them. On a computer, drag from one star to another." },
  { icon: <CalendarCheck2 className="h-5 w-5" />, color: "#4D8DFF", title: "See your day", text: "Tap the calendar for everything due today, and jot down how the day went." },
];

/** A short welcome over a dimmed sky: four cards with dots, Skip and Next ("Start exploring" at the end). */
export function Welcome({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const [dir, setDir] = useState(1);
  const last = i === STEPS.length - 1;
  const go = (n: number) => {
    if (n < 0 || n >= STEPS.length) return;
    setDir(n > i ? 1 : -1);
    setI(n);
  };
  const next = () => (last ? onDone() : go(i + 1));
  const nextRef = useRef<HTMLButtonElement>(null);
  useEffect(() => nextRef.current?.focus({ preventScroll: true }), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onDone(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); go(i - 1); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });
  // A sideways swipe on the card moves between steps too.
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const step = STEPS[i]!;

  return (
    <motion.div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 px-5 backdrop-blur-[1.5px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, pointerEvents: "none", transition: { duration: 0.4, ease: EASE } }}
      transition={{ duration: 0.8, ease: EASE }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
      data-testid="welcome"
    >
      <motion.div
        className="sheet-panel relative w-full max-w-[22.5rem] overflow-hidden rounded-[24px] px-6 pb-5 pt-6"
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.98, transition: { duration: 0.3, ease: EASE } }}
        transition={{ duration: 0.8, ease: EASE, delay: 0.15 }}
        onPointerDown={(e) => { swipe.current = { x: e.clientX, y: e.clientY }; }}
        onPointerUp={(e) => {
          const s = swipe.current;
          swipe.current = null;
          if (!s) return;
          const dx = e.clientX - s.x;
          if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(e.clientY - s.y) * 1.5) {
            if (dx < 0) next();
            else go(i - 1);
          }
        }}
      >
        <button
          onClick={onDone}
          className="absolute right-3 top-3 z-10 flex h-11 min-w-11 items-center justify-center rounded-full px-3 text-[13px] text-muted-foreground transition-colors hover:text-foreground md:h-9"
          data-testid="button-welcome-skip"
        >
          Skip
        </button>
        <div className="relative h-[10.5rem]">
          <AnimatePresence initial={false} custom={dir} mode="popLayout">
            <motion.div
              key={i}
              custom={dir}
              className="absolute inset-0"
              initial={{ opacity: 0, x: dir * 28 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: dir * -28 }}
              transition={{ duration: 0.45, ease: EASE }}
            >
              <div
                className="mb-5 flex h-11 w-11 items-center justify-center rounded-full"
                style={{ color: step.color, background: `${step.color}1f`, boxShadow: `0 0 28px ${step.color}33` }}
                aria-hidden
              >
                {step.icon}
              </div>
              <h2 id="welcome-title" className="pr-10 text-[19px] font-medium leading-snug tracking-[-0.01em] text-foreground" data-testid="text-welcome-title">
                {step.title}
              </h2>
              <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">{step.text}</p>
            </motion.div>
          </AnimatePresence>
        </div>
        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center" role="tablist" aria-label="Welcome steps">
            {STEPS.map((s, n) => (
              <button
                key={s.title}
                onClick={() => go(n)}
                role="tab"
                aria-selected={n === i}
                aria-label={`Step ${n + 1} of ${STEPS.length}`}
                className="flex h-11 w-6 items-center justify-center md:h-8"
                data-testid={`button-welcome-dot-${n}`}
              >
                <span className={`block h-1.5 rounded-full transition-all duration-500 soft-ease ${n === i ? "w-4 bg-primary" : "w-1.5 bg-white/20"}`} />
              </button>
            ))}
          </div>
          <button
            ref={nextRef}
            onClick={next}
            className="h-11 rounded-full bg-primary px-5 text-[13.5px] font-medium text-primary-foreground transition-all duration-300 soft-ease hover:brightness-105 active:scale-[0.97] md:h-10"
            data-testid="button-welcome-next"
          >
            {last ? "Start exploring" : "Next"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/** A small one-time tip that points up at what it describes. Tapping it puts it away. */
export function OnceTip({ text, onDismiss, className = "", testId }: { text: string; onDismiss: () => void; className?: string; testId?: string }) {
  return (
    <motion.button
      type="button"
      onClick={(e) => { e.stopPropagation(); onDismiss(); }}
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4, transition: { duration: 0.3 } }}
      transition={{ duration: 0.7, ease: EASE, delay: 0.5 }}
      className={`absolute z-20 whitespace-nowrap rounded-full bg-[hsl(36_35%_18%)] px-3.5 py-2 text-[12.5px] text-foreground/95 shadow-[0_8px_24px_rgba(0,0,0,0.45),0_0_0_1px_hsl(39_84%_74%/0.25)] ${className}`}
      aria-label={`${text}. Tap to dismiss`}
      data-testid={testId}
    >
      <span className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-[hsl(36_35%_18%)] shadow-[-1px_-1px_0_0_hsl(39_84%_74%/0.25)]" aria-hidden />
      {text}
    </motion.button>
  );
}
