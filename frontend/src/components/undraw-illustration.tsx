"use client";

import { ILLUSTRATIONS, type IllustrationName } from "@/components/illustrations";
import { cn } from "@/lib/utils";

/**
 * Renders a theme-aware illustration. The artwork is inlined as SVG and its
 * accent color follows var(--primary), so it matches the portal theme chosen
 * by the admin (light/dark + any custom color).
 */
export function UndrawIllustration({
  name,
  alt = "",
  className,
}: {
  name: IllustrationName;
  alt?: string;
  className?: string;
}) {
  const Illustration = ILLUSTRATIONS[name];
  return (
    <Illustration
      role="img"
      aria-label={alt}
      className={cn("h-auto w-full select-none", className)}
    />
  );
}
