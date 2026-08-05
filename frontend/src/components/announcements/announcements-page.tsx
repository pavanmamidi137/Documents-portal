"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Megaphone, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/layout/page-header";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { AnnouncementFormDialog } from "./announcement-form-dialog";
import { http } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Announcement, MetaData, Paginated } from "@/lib/types";
import { formatDateTime, getErrorMessage } from "@/lib/utils";

const VISIBILITY_STYLES: Record<string, string> = {
  COLLEGE: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/30",
  BRANCH: "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30",
  SECTION: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  CR_ONLY: "bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/30",
  STUDENT_ONLY: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
};

export function AnnouncementsPage({ meta }: { meta: MetaData }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canManage = user?.is_super_admin ?? false;

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Announcement | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["announcements"],
    queryFn: () => http.get<Paginated<Announcement>>("/announcements/", { page_size: 50 }),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["announcements"] });

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await http.delete(`/announcements/${deleteTarget.id}/`);
      toast.success("Announcement deleted.");
      setDeleteTarget(null);
      invalidate();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Announcements"
        description="Important notices for students and CRs."
        actions={
          canManage && (
            <Button
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus className="size-4" /> New Announcement
            </Button>
          )
        }
      />

      <div className="space-y-4">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-2xl border bg-card p-5">
              <Skeleton className="mb-2 h-5 w-1/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="mt-2 h-4 w-2/3" />
            </div>
          ))
        ) : (data?.results?.length ?? 0) === 0 ? (
          <EmptyState
            icon={Megaphone}
            title="No announcements"
            description="New notices will appear here."
          />
        ) : (
          data?.results.map((a, i) => (
            <motion.div
              key={a.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: i * 0.05 }}
              className="group rounded-2xl border bg-card p-5 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">{a.title}</h3>
                    <Badge variant="outline" className={VISIBILITY_STYLES[a.visibility] ?? ""}>
                      {a.visibility_label}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {a.created_by_name ?? "Admin"} · {formatDateTime(a.created_at)}
                  </p>
                </div>
                {canManage && (
                  <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8"
                      onClick={() => {
                        setEditing(a);
                        setFormOpen(true);
                      }}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8 text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(a)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                )}
              </div>
              <p className="mt-3 text-sm whitespace-pre-wrap text-muted-foreground">{a.body}</p>
            </motion.div>
          ))
        )}
      </div>

      <AnnouncementFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        announcement={editing}
        meta={meta}
        onSaved={invalidate}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete announcement?"
        description={`"${deleteTarget?.title}" will be permanently removed.`}
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
