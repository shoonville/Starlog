export function Wordmark({ large = false }: { large?: boolean }) {
  const s = large ? 22 : 16;
  return (
    <div className="flex items-center gap-2.5" data-testid="text-wordmark">
      <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
        <circle cx="5" cy="17" r="1.6" fill="#B9A6F0" />
        <circle cx="12" cy="7" r="2.3" fill="#F4E4C4" />
        <circle cx="19" cy="14" r="1.4" fill="#EBA9C0" />
        <path d="M5 17 L12 7 L19 14" stroke="#E4DFF0" strokeOpacity="0.4" strokeWidth="0.8" fill="none" />
      </svg>
      <span className={`${large ? "text-[17px]" : "text-[13.5px]"} font-medium tracking-[0.01em] text-foreground`}>Starlog</span>
    </div>
  );
}
