import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AnonymousDesk, BindDesk } from "@/components/studio/anonymous-desk";
import { PlatformChooser } from "@/components/studio/platform-chooser";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getDesk } from "@/lib/desk/server";
import { Logo } from "@/components/logo";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const { sessionUser } = Route.useRouteContext();
  const { user, isPending } = useCurrentUserState();
  const signedIn = Boolean(user) || (isPending && Boolean(sessionUser));
  const [deskNumber, setDeskNumber] = useState<string | null>(null);
  const [deskReady, setDeskReady] = useState(false);

  const loadDesk = useCallback(async () => {
    try {
      const desk = await getDesk();
      setDeskNumber(desk?.deskNumber ?? null);
    } catch {
      setDeskNumber(null);
    } finally {
      setDeskReady(true);
    }
  }, []);

  useEffect(() => {
    if (!signedIn || isPending) {
      if (!isPending) setDeskReady(true);
      return;
    }
    void loadDesk();
  }, [signedIn, isPending, loadDesk]);

  if (isPending && !sessionUser) return <DeskSkeleton />;

  if (!signedIn || (!isPending && !user)) {
    return <AnonymousDesk onReady={(n) => setDeskNumber(n)} />;
  }

  if (!deskReady) return <DeskSkeleton />;
  if (!deskNumber) return <BindDesk onReady={(n) => setDeskNumber(n)} />;
  return <PlatformChooser deskNumber={deskNumber} />;
}

function DeskSkeleton() {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4 py-10 text-fg">
      <div className="w-full max-w-md">
        <Logo />
        <Skeleton className="mt-8 h-8 w-40" />
        <Skeleton className="mt-4 h-24 w-full" />
      </div>
    </main>
  );
}
