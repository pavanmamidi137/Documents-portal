"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Menu, Moon, Palette, PanelLeft, Search, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NotificationsBell } from "@/components/notifications/notifications-bell";
import { useAuth } from "@/lib/auth";
import { customThemeHex, isCustomTheme, useSiteTheme } from "@/lib/site-theme";
import { cn, getErrorMessage, initials } from "@/lib/utils";
import { ShareRequestBell } from "@/components/documents/share-request-bell";
import type { SidebarMode } from "./sidebar";

interface TopbarProps {
  onMenuClick: () => void;
  sidebarMode: SidebarMode;
  onSidebarModeChange: (mode: SidebarMode) => void;
}

export function Topbar({ onMenuClick, sidebarMode, onSidebarModeChange }: TopbarProps) {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();
  const { theme: siteTheme, themes, setTheme: setSiteTheme } = useSiteTheme();
  const router = useRouter();
  const [query, setQuery] = useState("");
  // Theme is only known after mount (avoids a server/client hydration mismatch
  // when toggling the Sun/Moon icon).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const isAdmin = user?.is_super_admin ?? false;

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim().length >= 2) {
      router.push(`/search?q=${encodeURIComponent(query.trim())}`);
    }
  };

  const applyTheme = async (key: string) => {
    try {
      await setSiteTheme(key);
      toast.success(
        `Portal theme changed to ${themes.find((t) => t.key === key)?.label ?? "custom color"}.`
      );
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  // Color picker: any color becomes a site-wide theme (custom:#RRGGBB).
  const customHex = customThemeHex(siteTheme) ?? "#f56d14";
  const isCustom = isCustomTheme(siteTheme);
  const applyCustomColor = async (hex: string) => {
    try {
      await setSiteTheme(`custom:${hex}`);
      toast.success("Portal theme changed to your custom color.");
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur-xl sm:px-6">
      <button
        onClick={onMenuClick}
        className="rounded-md p-2 text-muted-foreground hover:bg-muted lg:hidden"
        aria-label="Open menu"
      >
        <Menu className="size-5" />
      </button>

      {/* Only shows when the sidebar is hidden (the escape hatch to bring it back). */}
      {sidebarMode === "hidden" && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onSidebarModeChange("expanded")}
          className="hidden text-muted-foreground lg:inline-flex"
        >
          <PanelLeft className="size-4" /> Sidebar
        </Button>
      )}

      <form onSubmit={submitSearch} className="relative hidden max-w-md flex-1 sm:block">
        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search documents, students, announcements…"
          className="h-9 bg-muted/50 pl-9"
        />
      </form>

      <div className="ml-auto flex items-center gap-2">
        <NotificationsBell />
        <ShareRequestBell />

        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label="Toggle light/dark mode"
          className="text-muted-foreground"
        >
          {mounted && (theme === "dark" ? <Sun className="size-5" /> : <Moon className="size-5" />)}
        </Button>

        {isAdmin && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon" aria-label="Change portal theme" className="text-muted-foreground">
                  <Palette className="size-5" />
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuGroup>
                <DropdownMenuLabel>
                  <p className="text-sm font-semibold">Portal Theme</p>
                  <p className="text-xs font-normal text-muted-foreground">
                    Applied for everyone in the college.
                  </p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
              </DropdownMenuGroup>
              <div className="grid grid-cols-2 gap-1.5 p-2">
                {themes.map((t) => {
                  const active = t.key === siteTheme;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => applyTheme(t.key)}
                      className={cn(
                        "flex items-center gap-2 rounded-lg border p-2 text-left transition-colors",
                        active
                          ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                          : "hover:bg-muted"
                      )}
                    >
                      <span
                        className="size-6 shrink-0 rounded-full ring-1 ring-foreground/10"
                        style={{ background: `linear-gradient(135deg, ${t.colors[0]}, ${t.colors[1]})` }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{t.label}</span>
                      </span>
                      {active && <Check className="size-3.5 text-primary" />}
                    </button>
                  );
                })}
              </div>

              <DropdownMenuSeparator />
              {/* Color picker — pick ANY color and the whole portal updates. */}
              <div className="p-2 pt-1">
                <p className="px-1 pb-1.5 text-xs font-semibold text-muted-foreground">
                  Custom color
                </p>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border p-2 transition-colors hover:bg-muted">
                  <input
                    type="color"
                    value={customHex}
                    onChange={(e) => applyCustomColor(e.target.value)}
                    className="size-8 shrink-0 cursor-pointer appearance-none rounded-full border-0 bg-transparent p-0"
                    aria-label="Pick a custom portal color"
                    title="Pick any color — it applies everywhere"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {customHex.toUpperCase()}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      Any color, applied everywhere.
                    </span>
                  </span>
                  {isCustom && <Check className="size-3.5 shrink-0 text-primary" />}
                </label>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Profile icon — shows the uploaded picture, else initials. Clicking it opens the profile page directly. */}
        <button
          onClick={() => router.push("/profile")}
          className="flex size-9 items-center justify-center overflow-hidden rounded-full ring-1 ring-indigo-500/30 transition-transform hover:scale-105"
          aria-label="My Profile"
          title="My Profile"
        >
          {user?.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.avatar_url}
              alt={user?.full_name ?? "My Profile"}
              className="size-full object-cover"
            />
          ) : (
            <span className="flex size-full items-center justify-center bg-gradient-to-br from-indigo-500/20 to-violet-500/20 text-sm font-bold text-indigo-600 dark:text-indigo-400">
              {initials(user?.full_name ?? "?")}
            </span>
          )}
        </button>
      </div>
    </header>
  );
}
