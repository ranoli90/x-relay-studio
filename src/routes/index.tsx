import { createFileRoute } from "@tanstack/react-router";
import { PlatformChooser } from "@/components/studio/platform-chooser";

export const Route = createFileRoute("/")({ component: PlatformChooser });
