import { useStartDemo } from "@workspace/api-client-react";
import { useAuth } from "@workspace/replit-auth-web";
import { NightBackdrop } from "@/components/night-backdrop";
import { Wordmark } from "@/components/wordmark";

export default function Landing() {
  const { login } = useAuth();
  const demo = useStartDemo();

  return (
    <div className="relative min-h-[100dvh] overflow-hidden">
      <NightBackdrop constellation />
      <div className="relative z-10 flex min-h-[100dvh] flex-col px-6 py-6 md:px-12 md:py-9">
        <header className="flex items-center justify-between rise">
          <Wordmark large />
          <button onClick={login} className="rounded-full px-4 py-2 text-[13px] text-muted-foreground transition-colors duration-500 hover:text-foreground" data-testid="button-login-header">
            Log in
          </button>
        </header>

        <main className="flex flex-1 items-end pb-10 md:items-center md:pb-0">
          <div className="max-w-xl">
            <p className="mb-6 text-[11.5px] uppercase tracking-[0.28em] text-[hsl(258_45%_80%)] rise" style={{ animationDelay: "200ms" }}>
              A journal shaped like a night sky
            </p>
            <h1 className="text-[42px] font-light leading-[1.05] tracking-[-0.035em] text-foreground rise md:text-[64px]" style={{ animationDelay: "350ms" }}>
              Every thought
              <br />
              gets its own star.
            </h1>
            <p className="mt-6 max-w-md text-[15.5px] leading-relaxed text-muted-foreground rise" style={{ animationDelay: "550ms" }}>
              Write things down, one quiet note at a time. Topics glow brighter as you return to them,
              and the ones that belong together become constellations you can name.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-3 rise" style={{ animationDelay: "750ms" }}>
              <button onClick={login} className="rounded-full bg-primary px-6 py-3 text-[14px] font-medium text-primary-foreground shadow-[0_10px_40px_-12px_rgba(244,214,170,0.55)] transition-transform duration-500 soft-ease hover:scale-[1.03]" data-testid="button-login">
                Log in
              </button>
              <button
                onClick={() => demo.mutate({ data: { tz: Intl.DateTimeFormat().resolvedOptions().timeZone } }, { onSuccess: () => window.location.reload() })}
                disabled={demo.isPending}
                className="rounded-full border border-white/10 bg-white/[0.03] px-6 py-3 text-[14px] text-foreground/90 backdrop-blur transition-all duration-500 soft-ease hover:bg-white/[0.07] disabled:opacity-60"
                data-testid="button-try-demo"
              >
                {demo.isPending ? <span className="breathe">Arranging a sample sky</span> : "Try the demo"}
              </button>
            </div>
            {demo.isError && <p className="mt-4 text-[13px] text-[hsl(350_62%_76%)]">The demo sky didn't open. Give it another try.</p>}
          </div>
        </main>

        <footer className="grid gap-6 border-t border-white/[0.06] pt-6 text-[12.5px] text-muted-foreground/80 rise sm:grid-cols-3 md:max-w-3xl" style={{ animationDelay: "1000ms" }}>
          <div><span className="text-foreground/90">Place a star.</span> Double-click anywhere in the sky to start a topic.</div>
          <div><span className="text-foreground/90">Keep a thread.</span> Notes stay in order, each with its own moment.</div>
          <div><span className="text-foreground/90">Draw the lines.</span> Connect what belongs together and name it.</div>
        </footer>
      </div>
    </div>
  );
}
