"use client";

import { useState } from "react";
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
import { useAuth } from "@/lib/auth";
import { useSiteTheme } from "@/lib/site-theme";
import { cn, getErrorMessage } from "@/lib/utils";
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
      toast.success(`Portal theme changed to ${themes.find((t) => t.key === key)?.label}.`);
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
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label="Toggle light/dark mode"
          className="text-muted-foreground"
        >
          {theme === "dark" ? <Sun className="size-5" /> : <Moon className="size-5" />}
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
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  );
}
