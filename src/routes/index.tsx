import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AnonymousDesk, BindDesk } from "@/components/studio/anonymous-desk";
import { PlatformChooser } from "@/components/studio/platform-chooser";
import { DoorSkeleton } from "@/components/screen-stack";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getDesk } from "@/lib/desk/server";

export const Route = createFileRoute("/")({ component: Home });

type DeskCache = { userId: string; number: string | null };
let deskCache: DeskCache | null = null;

function Home() {
  const { sessionUser } = Route.useRouteContext();
  const { user, isPending } = useCurrentUserState();
  const userId = user?.id ?? sessionUser?.id ?? null;
  const cached = userId && deskCache?.userId === userId ? deskCache : null;
  const [deskNumber, setDeskNumber] = useState<string | null>(cached?.number ?? null);
  const [deskReady, setDeskReady] = useState(Boolean(cached));
  const [holdWelcome, setHoldWelcome] = useState(false);

  const loadDesk = useCallback(async () => {
    if (!userId) return;
    try {
      const desk = await getDesk();
      const number = desk?.deskNumber ?? null;
      deskCache = { userId, number };
      setDeskNumber(number);
    } catch {
      if (!deskCache || deskCache.userId !== userId) setDeskNumber(null);
    } finally {
      setDeskReady(true);
    }
  }, [userId]);

  const signedIn = Boolean(user) || Boolean(sessionUser);

  useEffect(() => {
    if (holdWelcome) return;
    if (!user) {
      if (!isPending) setDeskReady(true);
      return;
    }
    void loadDesk();
  }, [user, isPending, loadDesk, holdWelcome]);

  const welcome = (
    <AnonymousDesk
      onBegin={() => setHoldWelcome(true)}
      onReady={(n) => {
        setHoldWelcome(false);
        const id = user?.id ?? sessionUser?.id ?? userId;
        if (id) deskCache = { userId: id, number: n };
        setDeskNumber(n);
        setDeskReady(true);
      }}
    />
  );

  if (holdWelcome) return welcome;

  // No cookie and no user yet — show the real door, not a blank shell.
  if (!signedIn) return welcome;
  if (isPending && !user) {
    if (cached?.number) return <PlatformChooser deskNumber={cached.number} />;
    return <DoorSkeleton />;
  }
  if (!user) return welcome;
  if (!deskReady) return <DoorSkeleton />;
  if (!deskNumber) return <BindDesk onReady={(n) => {
    deskCache = { userId: user.id, number: n };
    setDeskNumber(n);
  }} />;
  return <PlatformChooser deskNumber={deskNumber} />;
}
