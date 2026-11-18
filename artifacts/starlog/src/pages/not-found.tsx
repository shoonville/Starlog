import { Link } from "wouter";
import { NightBackdrop } from "@/components/night-backdrop";

export default function NotFound() {
  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center px-6">
      <NightBackdrop />
      <div className="relative z-10 text-center rise">
        <p className="mb-4 text-[11px] uppercase tracking-[0.3em] text-[hsl(258_45%_80%)]">Uncharted</p>
        <h1 className="text-[32px] font-light tracking-[-0.03em] text-foreground">No star lives here.</h1>
        <p className="mt-3 text-[14px] text-muted-foreground">This corner of the sky is empty.</p>
        <Link href="/" className="mt-8 inline-block rounded-full bg-primary px-5 py-2.5 text-[13.5px] font-medium text-primary-foreground" data-testid="link-home">
          Back to your sky
        </Link>
      </div>
    </div>
  );
}
