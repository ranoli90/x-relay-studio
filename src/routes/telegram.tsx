import { createFileRoute } from "@tanstack/react-router";
import { TelegramPlaceholder } from "@/components/studio/telegram-placeholder";

export const Route = createFileRoute("/telegram")({ component: TelegramPlaceholder });
