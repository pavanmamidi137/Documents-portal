"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  BookOpenText,
  Boxes,
  Building2,
  FolderKanban,
  GraduationCap,
  Layers,
  LayoutDashboard,
  Megaphone,
  ScrollText,
  Settings2,
  Tags,
  Users,
  X,
} from "lucide-react";

import { useAuth } from "@/lib/auth";
import { cn, initials } from "@/lib/utils";

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

const ADMIN_ONLY: NavItem[] = [
  { href: "/admin/branches", label: "Branches", icon: Building2 },
  { href: "/admin/sections", label: "Sections", icon: Layers },
  { href: "/admin/students", label: "Students", icon: Users },
  { href: "/admin/subjects", label: "Subjects", icon: BookOpenText },
  { href: "/admin/semesters", label: "Semesters", icon: Settings2 },
  { href: "/admin/categories", label: "Categories", icon: Tags },
  { href: "/admin/audit-logs", label: "Audit Logs", icon: ScrollText },
];

const CR_ONLY: NavItem[] = [
  { href: "/cr/students", label: "Students", icon: Users },
];

export function Sidebar({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const { user } = useAuth();

  const items: NavItem[] = [];
  if (user?.is_super_admin) {
    items.push(...COMMON, ...ADMIN_ONLY);
  } else if (user?.is_cr) {
    items.push(COMMON[0], ...CR_ONLY, COMMON[1], COMMON[2]);
  } else {
    items.push(...COMMON);
  }

  const nav = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center gap-3 border-b px-5">
        <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-md shadow-indigo-500/30">
          <GraduationCap className="size-5 text-white" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight">Document Portal</p>
          <p className="truncate text-[11px] text-muted-foreground">College Management</p>
        </div>
        <button
          onClick={onClose}
          className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-muted lg:hidden"
          aria-label="Close sidebar"
        >
          <X className="size-4" />
        </button>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              className={cn(
                "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
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
              <span className="relative z-10">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <div className="flex size-9 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500/20 to-violet-500/20 text-sm font-bold text-indigo-600 ring-1 ring-indigo-500/30 dark:text-indigo-400">
            {initials(user?.full_name ?? "?")}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{user?.full_name}</p>
            <p className="truncate text-[11px] capitalize text-muted-foreground">
              {user?.role_label.toLowerCase()}
            </p>
          </div>
          <Boxes className="ml-auto size-4 text-muted-foreground/50" />
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop */}
      <aside className="hidden w-64 shrink-0 border-r bg-sidebar lg:block">{nav}</aside>
      {/* Mobile overlay */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={onClose} />
          <motion.aside
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className="absolute inset-y-0 left-0 w-72 border-r bg-sidebar shadow-2xl"
          >
            {nav}
          </motion.aside>
        </div>
      )}
    </>
  );
}
