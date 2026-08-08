"use client";

import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  icon: Icon,
  gradient,
  delay = 0,
}: {
  label: string;
  value: number | string;
  icon: LucideIcon;
  gradient: string;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: delay * 0.07 }}
      whileHover={{ y: -4 }}
      className="group relative overflow-hidden rounded-2xl border bg-card p-5 shadow-sm transition-shadow hover:shadow-md"
    >
      <div
        className={cn(
          "absolute -top-8 -right-8 size-24 rounded-full bg-gradient-to-br opacity-15 blur-2xl transition-opacity group-hover:opacity-25",
          gradient
        )}
      />
      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className="mt-2 text-3xl font-bold tracking-tight tabular-nums">{value}</p>
        </div>
        <div
          className={cn(
            "flex size-11 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md",
            gradient
          )}
        >
          <Icon className="size-5" />
        </div>
      </div>
    </motion.div>
  );
}
