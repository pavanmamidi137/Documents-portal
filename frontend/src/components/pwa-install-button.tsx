"use client";

import { useEffect, useState } from "react";
import { Download, Smartphone, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Reusable PWA install button.  Triggers the browser's native install
 * prompt when available, otherwise shows manual add-to-home-screen steps.
 * Works in both expanded (full button) and collapsed (icon-only) sidebar modes.
 */
export function PwaInstallButton({
  size = "default",
  variant = "ghost",
  className,
  compact = false,
}: {
  size?: "default" | "sm" | "lg";
  variant?: "default" | "outline" | "ghost";
  className?: string;
  compact?: boolean;
}) {
  const [installPrompt, setInstallPrompt] = useState<Event | null>(null);
  const [showSteps, setShowSteps] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  // Already running as installed PWA — hide the button.
  const standalone =
    typeof window !== "undefined" &&
    (window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true);
  if (standalone) return null;

  if (installPrompt) {
    if (compact) {
      return (
        <Button
          size={size}
          variant={variant}
          className={cn("w-full justify-center", className)}
          onClick={() => {
            const promptEvent = installPrompt as unknown as {
              prompt: () => Promise<void>;
              userChoice: Promise<{ outcome: string }>;
            };
            void promptEvent.prompt();
            setInstallPrompt(null);
          }}
          title="Install app"
        >
          <Download className="size-4.5 shrink-0" />
        </Button>
      );
    }
    return (
      <Button
        size={size}
        variant={variant}
        className={cn("gap-3", className)}
        onClick={() => {
          const promptEvent = installPrompt as unknown as {
            prompt: () => Promise<void>;
            userChoice: Promise<{ outcome: string }>;
          };
          void promptEvent.prompt();
          setInstallPrompt(null);
        }}
      >
        <Download className="size-4.5 shrink-0" />
        <span>Install app</span>
      </Button>
    );
  }

  // Browser doesn't support the install prompt (iOS Safari etc.) — show
  // manual steps instead.
  if (compact) {
    return (
      <div className="relative">
        <Button
          size={size}
          variant={variant}
          className={cn("w-full justify-center", className)}
          onClick={() => setShowSteps((v) => !v)}
          title="Install app"
        >
          <Download className="size-4.5 shrink-0" />
        </Button>
        {showSteps && (
          <div className="absolute bottom-full left-0 z-50 mb-2 w-64 rounded-2xl border bg-card p-4 text-left shadow-xl">
            <p className="text-xs font-semibold">Add to home screen</p>
            <ul className="mt-2 space-y-2 text-[11px] text-muted-foreground">
              <li className="flex items-start gap-2">
                <Smartphone className="mt-0.5 size-3 shrink-0 text-primary" />
                <span>
                  <b className="font-medium text-foreground">Android:</b> tap browser menu (⋮) →{" "}
                  <b>Install app</b>
                </span>
              </li>
              <li className="flex items-start gap-2">
                <Share2 className="mt-0.5 size-3 shrink-0 text-primary" />
                <span>
                  <b className="font-medium text-foreground">iPhone:</b> tap Share →{" "}
                  <b>Add to Home Screen</b>
                </span>
              </li>
              <li className="flex items-start gap-2">
                <Download className="mt-0.5 size-3 shrink-0 text-primary" />
                <span>
                  <b className="font-medium text-foreground">Desktop:</b> click install icon in
                  address bar
                </span>
              </li>
            </ul>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={cn("relative", className)}>
      <Button size={size} variant={variant} onClick={() => setShowSteps((v) => !v)}>
        <Download className="size-4.5 shrink-0" />
        <span>Install app</span>
      </Button>
      {showSteps && (
        <div className="absolute left-0 z-30 mt-3 w-72 rounded-2xl border bg-card p-4 text-left shadow-xl">
          <p className="text-sm font-semibold">Add PlaceMate to your home screen</p>
          <ul className="mt-3 space-y-2.5 text-xs text-muted-foreground">
            <li className="flex items-start gap-2">
              <Smartphone className="mt-0.5 size-3.5 shrink-0 text-primary" />
              <span>
                <b className="font-medium text-foreground">Android / Windows:</b> open the browser
                menu (⋮) and tap <b className="font-medium text-foreground">Install app</b>.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <Share2 className="mt-0.5 size-3.5 shrink-0 text-primary" />
              <span>
                <b className="font-medium text-foreground">iPhone / iPad:</b> tap the Share button
                then <b className="font-medium text-foreground">Add to Home Screen</b>.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <Download className="mt-0.5 size-3.5 shrink-0 text-primary" />
              <span>
                <b className="font-medium text-foreground">Desktop:</b> click the install icon in
                the address bar.
              </span>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
