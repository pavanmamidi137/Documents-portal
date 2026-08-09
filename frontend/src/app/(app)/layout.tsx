"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Sidebar, type SidebarMode } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { useAuth } from "@/lib/auth";
import { useSwipe } from "@/lib/use-swipe";

const SIDEBAR_STORAGE_KEY = "portal_sidebar_mode";

function loadSidebarMode(): SidebarMode {
  if (typeof window === "undefined") return "expanded";
  try {
    const saved = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (saved === "collapsed" || saved === "hidden") return saved;
  } catch {
    /* ignore */
  }
  return "expanded";
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false); // mobile overlay
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>(loadSidebarMode);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  const changeSidebarMode = (mode: SidebarMode) => {
    setSidebarMode(mode);
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, mode);
    } catch {
      /* ignore */
    }
  };

  // Mobile swipe gestures (touch only): drag right from the left edge to open
  // the sidebar; when it is open, drag left over the content to close it.
  useSwipe({
    onSwipeRight: () => setSidebarOpen(true),
    onSwipeLeft: () => sidebarOpen && setSidebarOpen(false),
    edgeOnlyLeft: !sidebarOpen,
    edgeWidth: 44,
  });

  if (loading || !user) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading your portal…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-muted/20">
      <Sidebar
        mode={sidebarMode}
        onModeChange={changeSidebarMode}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onOpen={() => setSidebarOpen(true)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          onMenuClick={() => setSidebarOpen(true)}
          sidebarMode={sidebarMode}
          onSidebarModeChange={changeSidebarMode}
        />
        <main className="flex-1 overflow-x-hidden overflow-y-auto">
          <div className="mx-auto w-full min-w-0 max-w-7xl p-4 sm:p-6 lg:p-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
