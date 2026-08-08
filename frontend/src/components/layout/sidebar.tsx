"use client";

import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  BookOpenText,
  BrainCircuit,
  Briefcase,
  Building2,
  ChevronsLeft,
  ChevronsRight,
  FileUser,
  FolderKanban,
  GraduationCap,
  Layers,
  LayoutDashboard,
  LogOut,
  Megaphone,
  PanelLeftClose,
  ScrollText,
  Settings2,
  ShieldCheck,
  Tags,
  Users,
  X,
} from "lucide-react";

import { useAuth } from "@/lib/auth";
import { fetchMyResume, http } from "@/lib/api";
import type { Drive } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// Students: show an amber dot on Placements until they open the page.
const PLACEMENT_SEEN_KEY = "placement_seen_at";

export type SidebarMode = "expanded" | "collapsed" | "hidden";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface NavGroup {
  /** Section label shown above the items (undefined for the first group). */
  label?: string;
  items: NavItem[];
}

const COMMON: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/documents", label: "Documents", icon: FolderKanban },
  { href: "/announcements", label: "Announcements", icon: Megaphone },
  { href: "/placements", label: "Placements", icon: Briefcase },
];

const STUDENT_ONLY: NavItem[] = [{ href: "/resume", label: "My Resume", icon: FileUser }];

const FACULTY_ONLY: NavItem[] = [{ href: "/faculty/resumes", label: "Resumes", icon: FileUser }];

const ADMIN_ONLY: NavItem[] = [
  { href: "/admin/admins", label: "Admins", icon: ShieldCheck },
  { href: "/admin/ai-usage", label: "AI Usage", icon: BrainCircuit },
  { href: "/admin/faculty", label: "Faculty", icon: GraduationCap },
  { href: "/admin/students", label: "Students", icon: Users },
  { href: "/admin/branches", label: "Branches", icon: Building2 },
  { href: "/admin/sections", label: "Sections", icon: Layers },
  { href: "/admin/semesters", label: "Semesters", icon: Settings2 },
  { href: "/admin/subjects", label: "Subjects", icon: BookOpenText },
  { href: "/admin/categories", label: "Categories", icon: Tags },
  { href: "/admin/audit-logs", label: "Audit Logs", icon: ScrollText },
];

const CR_ONLY: NavItem[] = [{ href: "/cr/students", label: "Students", icon: Users }];

interface SidebarProps {
  mode: SidebarMode;
  onModeChange: (mode: SidebarMode) => void;
  open: boolean;
  onClose: () => void;
  onOpen: () => void;
}

export function Sidebar({ mode, onModeChange, open, onClose, onOpen }: SidebarProps) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const isStudent = user?.is_student ?? false;

  // Students: track resume status. Shares the cache key with the /resume page
  // and the dashboard, so the amber dot disappears the moment they upload.
  const { data: myResume } = useQuery({
    queryKey: ["resume", "mine"],
    queryFn: fetchMyResume,
    enabled: isStudent,
    staleTime: 30_000,
  });
  const showResumeDot = isStudent && myResume === null;

  // Students: a new drive (posted after their last visit) shows a dot on the
  // Placements item. Visiting /placements clears it via localStorage.
  const { data: drives } = useQuery({
    queryKey: ["drives", "latest"],
    queryFn: () => http.get<Drive[]>("/drives/?status=open"),
    enabled: isStudent,
    staleTime: 30_000,
  });
  const showPlacementsDot = (() => {
    if (!isStudent || !drives || drives.length === 0) return false;
    const latest = new Date(drives[0].created_at).getTime();
    if (Number.isNaN(latest)) return false;
    let seen = 0;
    try {
      seen = Number(localStorage.getItem(PLACEMENT_SEEN_KEY) || 0);
    } catch {
      /* private mode */
    }
    return latest > seen;
  })();

  // Navigation is grouped so long lists (admin) read as sections instead of a
  // wall of links. The first group carries no label - it is the app's main
  // navigation, the labelled groups are role-specific tools.
  let groups: NavGroup[] = [];
  if (user?.is_super_admin) {
    groups = [
      { items: [...COMMON] },
      { label: "Administration", items: ADMIN_ONLY },
      { label: "Faculty", items: FACULTY_ONLY },
    ];
  } else if (user?.is_cr) {
    groups = [{ items: [COMMON[0], ...CR_ONLY, COMMON[1], COMMON[2]] }];
  } else if (user?.is_faculty) {
    groups = [
      { items: [COMMON[0], COMMON[2]] },
      { label: "Faculty", items: FACULTY_ONLY },
    ];
  } else {
    groups = [{ items: [...COMMON] }, { label: "Career", items: STUDENT_ONLY }];
  }

  const collapsed = mode === "collapsed";

  const headerButtons = (compact: boolean) => (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              onClick={() => onModeChange(compact ? "expanded" : "collapsed")}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label={compact ? "Expand sidebar" : "Collapse sidebar"}
            >
              {compact ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
            </button>
          }
        />
        <TooltipContent>{compact ? "Expand" : "Minimize"}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              onClick={() => onModeChange("hidden")}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Hide sidebar"
            >
              <PanelLeftClose className="size-4" />
            </button>
          }
        />
        <TooltipContent>Hide sidebar</TooltipContent>
      </Tooltip>
    </>
  );

  /**
   * @param compact  icons-only layout (desktop collapsed mode)
   * @param showControls  render the desktop collapse/hide buttons (never on mobile)
   */
  const nav = (compact: boolean, showControls: boolean) => (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div
        className={cn(
          "flex min-h-16 shrink-0 items-center gap-3 border-b px-4",
          compact && "flex-col gap-2 px-1 py-2"
        )}
      >
        <Link
          href="/dashboard"
          onClick={onClose}
          className={cn("flex items-center gap-3", compact && "flex-col gap-1.5")}
        >
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/60 shadow-md shadow-primary/30">
            <GraduationCap className="size-5 text-primary-foreground" />
          </div>
          {!compact && (
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-tight">Document Portal</p>
              <p className="truncate text-[11px] text-muted-foreground">College Management</p>
            </div>
          )}
        </Link>
        <div className={cn("ml-auto flex items-center gap-1", compact && "ml-0 mt-1")}>
          {showControls && headerButtons(compact)}
        </div>
        <button
          onClick={onClose}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted lg:hidden"
          aria-label="Close sidebar"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-5 overflow-y-auto p-3">
        {groups.map((group, gi) => (
          <div key={gi} className="space-y-0.5">
            {group.label && (
              compact ? (
                <div className="mx-auto my-2 h-px w-7 rounded-full bg-border" aria-hidden="true" />
              ) : (
                <p className="px-3 pt-1 pb-1.5 text-[10px] font-semibold tracking-widest text-muted-foreground/70 uppercase">
                  {group.label}
                </p>
              )
            )}
            {group.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + "/");
              const link = (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onClose}
                  className={cn(
                    "relative flex items-center gap-3 rounded-lg py-2 text-sm font-medium transition-colors",
                    compact ? "justify-center px-0" : "px-3",
                    active
                      ? "bg-primary/10 font-semibold text-foreground"
                      : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="sidebar-active"
                      className="absolute top-1/2 left-0 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary"
                      transition={{ type: "spring", stiffness: 400, damping: 32 }}
                    />
                  )}
                  <item.icon
                    className={cn("relative z-10 size-4.5 shrink-0", active && "text-primary")}
                  />
                  {!compact && <span className="relative z-10">{item.label}</span>}
                  {(item.href === "/resume" && showResumeDot) ||
                    (item.href === "/placements" && showPlacementsDot) ? (
                    <span
                      className={cn(
                        "absolute top-1/2 z-10 size-2 -translate-y-1/2 rounded-full bg-amber-500 shadow-sm ring-2 ring-amber-500/30",
                        compact ? "right-1.5" : "right-3"
                      )}
                      aria-hidden="true"
                    />
                  ) : null}
                </Link>
              );

              if (compact) {
                return (
                  <Tooltip key={item.href}>
                    <TooltipTrigger render={link} />
                    <TooltipContent side="right">{item.label}</TooltipContent>
                  </Tooltip>
                );
              }
              return link;
            })}
          </div>
        ))}
      </nav>

      {/* Footer — sign out (moved here from the profile page) */}
      <div className={cn("shrink-0 border-t p-3", compact && "p-2")}>
        {compact ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  onClick={logout}
                  className="flex w-full items-center justify-center rounded-lg py-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  aria-label="Sign out"
                >
                  <LogOut className="size-4.5 shrink-0" />
                </button>
              }
            />
            <TooltipContent side="right">Sign out</TooltipContent>
          </Tooltip>
        ) : (
          <button
            onClick={logout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <LogOut className="size-4.5 shrink-0" />
            <span>Sign out</span>
          </button>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop */}
      {mode !== "hidden" && (
        <motion.aside
          initial={false}
          animate={{ width: collapsed ? 76 : 256 }}
          transition={{ type: "spring", stiffness: 300, damping: 32 }}
          className="hidden shrink-0 overflow-hidden border-r bg-sidebar lg:block"
        >
          {nav(collapsed, true)}
        </motion.aside>
      )}

      {/* Mobile edge swipe handle (drag right to open) */}
      {!open && <EdgeSwipeHandle onOpen={onOpen} />}

      {/* Mobile overlay */}
      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/50"
              onClick={onClose}
            />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 34 }}
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={{ left: 0.22, right: 0 }}
              onDragEnd={(_, info) => {
                if (info.offset.x < -64 || info.velocity.x < -500) onClose();
              }}
              className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r bg-sidebar shadow-2xl"
            >
              {nav(false, false)}
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}

/** Small left-edge grabber: tap or swipe right to open the mobile sidebar. */
function EdgeSwipeHandle({ onOpen }: { onOpen: () => void }) {
  const draggedRef = useRef(false);

  return (
    <motion.button
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.3}
      onDragStart={() => {
        draggedRef.current = false;
      }}
      onDrag={(_, info) => {
        if (Math.abs(info.offset.x) > 6) draggedRef.current = true;
      }}
      onDragEnd={(_, info) => {
        if (info.offset.x > 56 || info.velocity.x > 400) onOpen();
      }}
      onClick={() => {
        if (!draggedRef.current) onOpen();
      }}
      className="fixed inset-y-0 left-0 z-40 flex w-4 cursor-ew-resize items-center justify-center lg:hidden"
      aria-label="Swipe or tap to open sidebar"
    >
      <span className="h-16 w-1.5 rounded-full bg-foreground/15 transition-colors hover:bg-foreground/30" />
    </motion.button>
  );
}
