import { useStartDemo } from "@workspace/api-client-react";
import { useAuth } from "@workspace/replit-auth-web";
import { NightBackdrop } from "@/components/night-backdrop";

export default function Landing() {
  const { login } = useAuth();
  const demo = useStartDemo();

  return (
    <div className="relative min-h-[100dvh] overflow-hidden">
      <NightBackdrop constellation />
      <div className="relative z-10 flex min-h-[100dvh] flex-col items-center px-6 pb-[max(2.5rem,env(safe-area-inset-bottom))] text-center">
        <main className="flex flex-1 flex-col items-center justify-center pt-[38dvh] md:pt-[34dvh]">
          <h1 className="text-[40px] font-light tracking-[-0.02em] text-foreground rise md:text-[56px]" style={{ animationDelay: "350ms" }}>
            Starlog
          </h1>
          <p className="mt-3 text-[11.5px] uppercase tracking-[0.28em] text-primary/85 rise" style={{ animationDelay: "550ms" }}>
            A journal shaped like a night sky
          </p>
        </main>

        <div className="grid w-full max-w-sm gap-3 rise" style={{ animationDelay: "800ms" }}>
          <button
            onClick={() => demo.mutate({ data: { tz: Intl.DateTimeFormat().resolvedOptions().timeZone } }, { onSuccess: () => window.location.reload() })}
            disabled={demo.isPending}
            className="rounded-full bg-primary px-6 py-3.5 text-[15px] font-medium text-primary-foreground shadow-[0_10px_40px_-12px_hsl(39_84%_66%/0.55)] transition-transform duration-500 soft-ease hover:scale-[1.02] disabled:opacity-70"
            data-testid="button-try-demo"
          >
            {demo.isPending ? <span className="breathe">Arranging a sample sky</span> : "Try the demo"}
          </button>
          <button
            onClick={login}
            className="rounded-full border border-white/10 bg-white/[0.03] px-6 py-3.5 text-[15px] text-foreground/90 backdrop-blur transition-all duration-500 soft-ease hover:bg-white/[0.07]"
            data-testid="button-login"
          >
            Log in
          </button>
          {demo.isError && <p className="mt-1 text-[13px] text-[hsl(350_62%_76%)]">The demo sky didn't open. Give it another try.</p>}
        </div>
      </div>
    </div>
  );
}
