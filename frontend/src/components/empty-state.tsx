import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";

import { UndrawIllustration } from "@/components/undraw-illustration";
import type { IllustrationName } from "@/components/illustrations";

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  illustration,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  /** Optional transparent illustration (file name without .svg) shown above the icon. */
  illustration?: IllustrationName;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed bg-card/50 px-6 py-16 text-center"
    >
      {illustration && (
        <UndrawIllustration
          name={illustration}
          alt=""
          className="mb-2 w-full max-w-xs"
        />
      )}
      <div className="flex size-14 items-center justify-center rounded-2xl bg-muted">
        <Icon className="size-7 text-muted-foreground" />
      </div>
      <div>
        <p className="font-semibold">{title}</p>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </motion.div>
  );
}
