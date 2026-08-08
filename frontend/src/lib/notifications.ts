import { Bell, FileText, MessageSquareText, UserRound } from "lucide-react";

export const NOTIFICATION_KIND_ICONS: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  DOCUMENT_UPLOAD: FileText,
  RESUME_UPLOAD: UserRound,
  CONTACT_ADMIN: MessageSquareText,
};

export const NOTIFICATION_KIND_COLORS: Record<string, string> = {
  // Documents use the active portal theme; resumes & admin replies keep
  // semantic accents so the three types stay distinguishable at a glance.
  DOCUMENT_UPLOAD: "bg-primary/10 text-primary",
  RESUME_UPLOAD: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
  CONTACT_ADMIN: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
};

export function notificationKindIcon(
  kind: string
): React.ComponentType<{ className?: string }> {
  return NOTIFICATION_KIND_ICONS[kind] ?? Bell;
}

export function notificationKindColor(kind: string): string {
  return NOTIFICATION_KIND_COLORS[kind] ?? "bg-primary/10 text-primary";
}
