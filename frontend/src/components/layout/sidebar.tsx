"use client";

import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  BookOpenText,
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
  Tags,
  Users,
  X,
} from "lucide-react";

import { useAuth } from "@/lib/auth";
import { fetchMyResume } from "@/lib/api";
import { cn, initials } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type SidebarMode = "expanded" | "collapsed" | "hidden";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const COMMON: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/documents", label: "Documents", icon: FolderKanban },
  { href: "/announcements", label: "Announcements", icon: Megaphone },
];

const STUDENT_ONLY: NavItem[] = [
  { href: "/resume", label: "My Resume", icon: FileUser },
];

const FACULTY_ONLY: NavItem[] = [
  { href: "/faculty/resumes", label: "Resumes", icon: FileUser },
];

const ADMIN_ONLY: NavItem[] = [
  { href: "/admin/branches", label: "Branches", icon: Building2 },
  { href: "/admin/sections", label: "Sections", icon: Layers },
  { href: "/admin/students", label: "Students", icon: Users },
  { href: "/admin/faculty", label: "Faculty", icon: GraduationCap },
  { href: "/admin/subjects", label: "Subjects", icon: BookOpenText },
  { href: "/admin/semesters", label: "Semesters", icon: Settings2 },
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

  const items: NavItem[] = [];
  if (user?.is_super_admin) {
    items.push(...COMMON, ...ADMIN_ONLY, { href: "/faculty/resumes", label: "Resumes", icon: FileUser });
  } else if (user?.is_cr) {
    items.push(COMMON[0], ...CR_ONLY, COMMON[1], COMMON[2]);
  } else if (user?.is_faculty) {
    items.push(COMMON[0], ...FACULTY_ONLY, COMMON[2]);
  } else {
    items.push(...COMMON, ...STUDENT_ONLY);
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
          "flex min-h-16 shrink-0 items-center gap-3 border-b px-3",
          compact && "flex-col gap-2 px-1 py-2"
        )}
      >
        <Link
          href="/dashboard"
          onClick={onClose}
          className={cn("flex items-center gap-3", compact && "flex-col gap-1.5")}
        >
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-md shadow-indigo-500/30">
            <GraduationCap className="size-5 text-white" />
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
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          const link = (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              className={cn(
                "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                compact && "justify-center px-0 py-2.5",
                active ? "text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {active && (
                <motion.span
                  layoutId="sidebar-active"
                  className="absolute inset-0 rounded-lg bg-primary/10 ring-1 ring-primary/20"
                  transition={{ type: "spring", stiffness: 400, damping: 32 }}
                />
              )}
              <item.icon className="relative z-10 size-4.5 shrink-0" />
              {!compact && <span className="relative z-10">{item.label}</span>}
              {item.href === "/resume" && showResumeDot && (
                <span
                  className={cn(
                    "absolute top-2 z-10 size-2 rounded-full bg-amber-500 shadow-sm ring-2 ring-amber-500/30",
                    compact ? "right-1.5" : "right-2.5"
                  )}
                  aria-hidden="true"
                />
              )}
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
      </nav>

      {/* Footer — profile + logout */}
      <div className="shrink-0 border-t p-3">
        <div className={cn("flex items-center gap-3 rounded-lg px-2 py-2", compact && "flex-col gap-2 px-0")}>
          <Tooltip>
            <TooltipTrigger
              render={
                <Link
                  href="/profile"
                  onClick={onClose}
                  className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500/20 to-violet-500/20 text-sm font-bold text-indigo-600 ring-1 ring-indigo-500/30 transition-transform hover:scale-105 dark:text-indigo-400"
                  aria-label="Open profile"
                >
                  {initials(user?.full_name ?? "?")}
                </Link>
              }
            />
            <TooltipContent>Profile</TooltipContent>
          </Tooltip>
          {!compact && (
            <Link
              href="/profile"
              onClick={onClose}
              className="min-w-0 flex-1 rounded-md transition-colors hover:text-foreground"
            >
              <p className="truncate text-sm font-medium">{user?.full_name}</p>
              <p className="truncate text-[11px] capitalize text-muted-foreground">
                {user?.role_label.toLowerCase()}
              </p>
            </Link>
          )}
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  onClick={logout}
                  className={cn(
                    "rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive",
                    !compact && "ml-auto"
                  )}
                  aria-label="Log out"
                >
                  <LogOut className="size-4" />
                </button>
              }
            />
            <TooltipContent>Log out</TooltipContent>
          </Tooltip>
        </div>
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
      {!open && (
        <EdgeSwipeHandle onOpen={onOpen} />
      )}

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
