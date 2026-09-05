import { createRouter } from "@tanstack/react-router";
import { DoorSkeleton } from "@/components/screen-stack";
import { AppErrorComponent } from "@/lib/error-component";
import { AppNotFound } from "@/lib/not-found";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({
    routeTree,
    defaultErrorComponent: AppErrorComponent,
    defaultNotFoundComponent: AppNotFound,
    defaultPendingComponent: DoorSkeleton,
    defaultPendingMs: 0,
    defaultPendingMinMs: 0,
  });
}
