"use client";

import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Loader2, Search, ShieldPlus, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { http } from "@/lib/api";
import type { Role, User } from "@/lib/types";
import { cn, getErrorMessage } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPromoted?: (admin: User) => void;
}

const roleStyles: Record<Role, string> = {
  STUDENT: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  CR: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  FACULTY: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  SUPER_ADMIN: "bg-primary/15 text-primary",
};

export function PromoteAdminDialog({ open, onOpenChange, onPromoted }: Props) {
  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(q);
  const [selected, setSelected] = useState<User | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { data: candidates, isLoading } = useQuery({
    queryKey: ["admins", "candidates", debouncedQ],
    queryFn: () =>
      http.get<User[]>("/admins/candidates/", { search: debouncedQ || undefined }),
    placeholderData: keepPreviousData,
    enabled: open,
  });

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setQ("");
      setSelected(null);
    }
    onOpenChange(next);
  };

  const confirmPromote = async () => {
    if (!selected) return;
    setSubmitting(true);
    try {
      const admin = await http.post<User>(`/admins/${selected.id}/promote/`);
      toast.success(
        `${admin.full_name} (${admin.roll_number}) is now a Super Admin. They keep their existing password and can log in right away.`,
        { duration: 7000 }
      );
      onOpenChange(false);
      onPromoted?.(admin);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const initials = (name: string) =>
    name
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0])
      .join("")
      .toUpperCase();

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldPlus className="size-5 text-primary" />
            Promote Existing User
          </DialogTitle>
          <DialogDescription>
            Pick a student, CR or faculty member already in the portal — their account becomes a
            Super Admin. No new account is created: they keep their roll number and password.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search by name, roll number, email…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
            />
          </div>

          <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading…
              </div>
            ) : candidates && candidates.length > 0 ? (
              candidates.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => setSelected(u)}
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-3 rounded-xl border p-2.5 text-left transition-colors",
                    selected?.id === u.id
                      ? "border-primary/60 bg-primary/10 ring-1 ring-primary/40"
                      : "border-transparent bg-muted/40 hover:border-border hover:bg-muted/70"
                  )}
                >
                  <Avatar className="size-9">
                    {u.avatar_url ? (
                      <AvatarImage src={u.avatar_url} alt={u.full_name} />
                    ) : null}
                    <AvatarFallback className="bg-primary/10 text-xs font-bold text-primary">
                      {initials(u.full_name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{u.full_name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {u.roll_number}
                      {u.branch_code
                        ? ` · ${u.branch_code}${u.section_name ? ` Sec ${u.section_name}` : ""}`
                        : ""}
                    </p>
                  </div>
                  <Badge variant="outline" className={cn("shrink-0", roleStyles[u.role])}>
                    {u.role === "CR" ? "CR" : u.role_label}
                  </Badge>
                </button>
              ))
            ) : (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {debouncedQ
                  ? "No students or faculty match this search."
                  : "No users available to promote."}
              </div>
            )}
          </div>

          <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <p>
              Promoting gives this person <span className="font-semibold">full control of the
              portal</span> — they can manage students, faculty, documents, drives and other
              admins. Choose carefully.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button type="button" onClick={confirmPromote} disabled={!selected || submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {selected
              ? `Promote ${selected.full_name.split(/\s+/)[0]}`
              : "Select a user"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
