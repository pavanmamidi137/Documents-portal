"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Menu, Moon, Search, Sun, UserRound, LogOut, KeyRound } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAuth } from "@/lib/auth";
import { initials } from "@/lib/utils";

export function Topbar({ onMenuClick }: { onMenuClick: () => void }) {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const [query, setQuery] = useState("");

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim().length >= 2) {
      router.push(`/search?q=${encodeURIComponent(query.trim())}`);
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
          aria-label="Toggle theme"
          className="text-muted-foreground"
        >
          {theme === "dark" ? <Sun className="size-5" /> : <Moon className="size-5" />}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button className="flex items-center gap-2 rounded-full p-0.5 ring-primary/30 transition hover:ring-2">
                <Avatar className="size-8">
                  <AvatarFallback className="bg-gradient-to-br from-indigo-500/20 to-violet-500/20 text-sm font-bold text-indigo-600 dark:text-indigo-400">
                    {initials(user?.full_name ?? "?")}
                  </AvatarFallback>
                </Avatar>
              </button>
            }
          />
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <p className="text-sm font-semibold">{user?.full_name}</p>
              <p className="text-xs font-normal text-muted-foreground">{user?.roll_number}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link href="/profile" />}>
              <UserRound className="size-4" /> Profile
            </DropdownMenuItem>
            <DropdownMenuItem render={<Link href="/profile#password" />}>
              <KeyRound className="size-4" /> Change Password
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout} className="text-destructive focus:text-destructive">
              <LogOut className="size-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
