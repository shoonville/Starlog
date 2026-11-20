import { useMemo } from "react";
import { SKY_THEMES, type SkyTheme } from "@/lib/sky-theme";
import { skyThumb } from "@/lib/sky-backdrop";

/** "Sky" section: five small previews of the sky themes, the current one ringed. */
export function SkyThemePicker({ value, onChange, className = "" }: { value: SkyTheme; onChange: (theme: SkyTheme) => void; className?: string }) {
  const thumbs = useMemo(() => SKY_THEMES.map((t) => ({ ...t, src: skyThumb(t.id) })), []);
  const current = SKY_THEMES.find((t) => t.id === value) ?? SKY_THEMES[0]!;
  return (
    <div className={className} data-testid="sky-theme-picker">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground/70">Sky</span>
        <span className="truncate text-[11.5px] text-muted-foreground" data-testid="text-sky-theme">{current.name}</span>
      </div>
      <div role="radiogroup" aria-label="Sky" className="flex justify-between gap-1.5">
        {thumbs.map((t) => {
          const on = t.id === value;
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={t.name}
              title={t.name}
              onClick={() => onChange(t.id)}
              className={`relative h-[54px] w-10 shrink-0 overflow-hidden rounded-lg outline-none transition-[box-shadow,transform] duration-300 soft-ease active:scale-95 focus-visible:ring-2 focus-visible:ring-white/40 ${
                on ? "shadow-[0_0_0_2px_hsl(240_8%_7%),0_0_0_3.5px_hsl(39_84%_74%)]" : "shadow-[0_0_0_1px_hsl(0_0%_100%/0.1)] hover:shadow-[0_0_0_1px_hsl(0_0%_100%/0.28)]"
              }`}
              data-testid={`button-sky-${t.id}`}
            >
              <img src={t.src} alt="" draggable={false} className="h-full w-full object-cover" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
