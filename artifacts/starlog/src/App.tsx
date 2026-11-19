import { type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Switch, useLocation, Router as WouterRouter } from "wouter";
import { getGetSkyQueryKey, useGetSky } from "@workspace/api-client-react";
import { useAuth } from "@workspace/replit-auth-web";
import { ErrorBoundary } from "@/components/error-boundary";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NightBackdrop } from "@/components/night-backdrop";
import NotFound from "@/pages/not-found";
import Landing from "@/pages/landing";
import SkyPage from "@/pages/sky";
import { saveRetryDelay, shouldRetrySave } from "@/lib/save-safety";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, staleTime: 15_000 },
    // Saves survive a dropped connection: they wait while offline and retry with a growing pause.
    mutations: { retry: shouldRetrySave, retryDelay: saveRetryDelay },
  },
});

function Quiet({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center px-6">
      <NightBackdrop />
      <div className="relative z-10 text-center">{children}</div>
    </div>
  );
}

function Home() {
  const auth = useAuth();
  const sky = useGetSky({ query: { queryKey: getGetSkyQueryKey(), retry: false } });

  if (auth.isLoading || sky.isLoading) {
    return (
      <Quiet>
        <div className="mx-auto mb-6 h-2 w-2 rounded-full bg-[#f4e4c4] shadow-[0_0_24px_6px_rgba(244,228,196,0.35)] breathe" />
        <p className="text-[13px] tracking-wide text-muted-foreground breathe" data-testid="status-loading">Gathering your stars</p>
      </Quiet>
    );
  }
  if (sky.data) return <SkyPage sky={sky.data} />;
  if (auth.user) {
    return (
      <Quiet>
        <h1 className="text-[24px] font-light tracking-[-0.02em] text-foreground">The sky is clouded over.</h1>
        <p className="mt-3 text-[14px] text-muted-foreground">We couldn't reach your stars just now.</p>
        <button onClick={() => sky.refetch()} className="mt-7 rounded-full bg-primary px-5 py-2.5 text-[13.5px] font-medium text-primary-foreground" data-testid="button-retry">
          Try again
        </button>
      </Quiet>
    );
  }
  return <Landing />;
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
