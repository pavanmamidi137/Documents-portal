"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Bot,
  Briefcase,
  Building2,
  CalendarDays,
  CheckCircle2,
  ExternalLink,
  GraduationCap,
  MapPin,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/layout/page-header";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { DriveAssistant } from "@/components/placements/ai-assistant";
import { DriveAskDialog } from "@/components/placements/drive-ask-dialog";
import { DriveFormDialog } from "@/components/placements/drive-form-dialog";
import { http } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Drive } from "@/lib/types";
import { cn, formatDate, getErrorMessage } from "@/lib/utils";

const PLACEMENT_SEEN_KEY = "placement_seen_at";

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Admin",
  FACULTY: "Faculty",
  CR: "CR",
};

function matchClasses(score: number) {
  if (score >= 70)
    return "border-violet-500/40 bg-violet-500/15 text-violet-700 dark:text-violet-300";
  if (score >= 45)
    return "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300";
  return "border-rose-500/40 bg-rose-500/15 text-rose-700 dark:text-rose-300";
}

const JOB_TYPE_LABELS: Record<string, string> = {
  JOB: "Job",
  INTERNSHIP: "Internship",
};

function JobTypeBadge({ jobType }: { jobType: string }) {
  if (!jobType) return null;
  const internship = jobType === "INTERNSHIP";
  return (
    <Badge
      variant="outline"
      className={
        internship
          ? "gap-1 border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400"
          : "gap-1 border-primary/30 bg-primary/10 text-primary"
      }
    >
      {internship ? <GraduationCap className="size-3" /> : <Briefcase className="size-3" />}
      {JOB_TYPE_LABELS[jobType] ?? jobType}
    </Badge>
  );
}

export default function PlacementsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"open" | "expired">("open");
  const [typeFilter, setTypeFilter] = useState<"ALL" | "JOB" | "INTERNSHIP">("ALL");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Drive | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Drive | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [askDrive, setAskDrive] = useState<Drive | null>(null);

  // Visiting the page clears the amber dot on the sidebar nav item.
  useEffect(() => {
    try {
      localStorage.setItem(PLACEMENT_SEEN_KEY, String(Date.now()));
    } catch {
      /* private mode */
    }
  }, []);

  // Both tabs are fetched so the tab counts stay correct whichever tab is open.
  const { data: openDrives, isLoading: openLoading } = useQuery({
    queryKey: ["drives", "open"],
    queryFn: () => http.get<Drive[]>("/drives/?status=open"),
  });
  const { data: expiredDrives, isLoading: expiredLoading } = useQuery({
    queryKey: ["drives", "expired"],
    queryFn: () => http.get<Drive[]>("/drives/?status=expired"),
  });
  const drives = (tab === "open" ? openDrives : expiredDrives)?.filter(
    (d) => typeFilter === "ALL" || d.job_type === typeFilter
  );
  const isLoading = tab === "open" ? openLoading : expiredLoading;
  const openCount = openDrives?.length;
  const expiredCount = expiredDrives?.length;

  const canWrite = Boolean(
    user && (user.is_super_admin || user.is_faculty || user.is_cr)
  );
  const canManage = (d: Drive) =>
    Boolean(user && (user.is_super_admin || d.posted_by === user.id));

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await http.delete(`/drives/${deleteTarget.id}/`);
      toast.success("Drive deleted.");
      queryClient.invalidateQueries({ queryKey: ["drives"] });
      setDeleteTarget(null);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Placements"
        description="Company drives & campus placements — check eligibility and apply before the last date."
      />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as "open" | "expired")}
          className="w-full sm:w-auto"
        >
          <TabsList>
            <TabsTrigger value="open">
              Open{openCount !== undefined ? ` (${openCount})` : ""}
            </TabsTrigger>
            <TabsTrigger value="expired">
              Expired{expiredCount !== undefined ? ` (${expiredCount})` : ""}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <div className="flex items-center gap-1 rounded-xl border bg-card p-1">
            {(["ALL", "JOB", "INTERNSHIP"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTypeFilter(t)}
                className={cn(
                  "flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                  typeFilter === t
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t === "JOB" && <Briefcase className="size-3.5" />}
                {t === "INTERNSHIP" && <GraduationCap className="size-3.5" />}
                {t === "ALL" ? "All" : JOB_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        </div>
        {canWrite && (
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="size-4" /> Post a Drive
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-2xl border bg-card p-5">
              <Skeleton className="mb-3 h-5 w-40" />
              <Skeleton className="mb-2 h-4 w-64" />
              <Skeleton className="h-4 w-48" />
            </div>
          ))}
        </div>
      ) : !drives || drives.length === 0 ? (
        <EmptyState
          icon={tab === "open" ? Briefcase : CalendarDays}
          title={tab === "open" ? "No open drives right now" : "No expired drives yet"}
          description={
            tab === "open"
              ? canWrite
                ? "Post the first drive — students will be notified instantly."
                : "New company drives will appear here as soon as they're posted."
              : "Drives move here after their last date to apply, and are removed 30 days later."
          }
          illustration={tab === "open" ? "business-pitch_h9yw" : "online-calendar_iz1q"}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {drives.map((d, i) => (
            <motion.div
              key={d.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: Math.min(i * 0.04, 0.3) }}
              onClick={() => router.push(`/placements/${d.id}`)}
              className={cn(
                "group relative flex cursor-pointer flex-col rounded-2xl border bg-card p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg",
                d.status === "OPEN" ? "hover:border-primary/30" : "opacity-80"
              )}
            >
              {/* Header */}
              <div className="flex items-start gap-3">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/60 text-lg font-bold text-primary-foreground shadow-sm shadow-primary/20">
                  {d.company_name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-base font-bold">{d.company_name}</h3>
                    <JobTypeBadge jobType={d.job_type} />
                    <Badge
                      variant="outline"
                      className={cn(
                        d.status === "OPEN"
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                          : "border-muted-foreground/20 bg-muted text-muted-foreground"
                      )}
                    >
                      {d.status === "OPEN" ? "Open" : "Expired"}
                    </Badge>
                    {d.is_eligible_for_me === true && (
                      <Badge className="border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                        <CheckCircle2 className="size-3" /> Eligible for you
                      </Badge>
                    )}
                    {d.my_match && (
                      <Badge
                        variant="outline"
                        className={`gap-1 ${matchClasses(d.my_match.score)}`}
                        title={d.my_match.reason || "AI match estimate from your resume"}
                      >
                        <TrendingUp className="size-3" /> {d.my_match.score}% match
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    {d.role && (
                      <span className="flex items-center gap-1">
                        <Briefcase className="size-3.5" /> {d.role}
                      </span>
                    )}
                    {d.location && (
                      <span className="flex items-center gap-1">
                        <MapPin className="size-3.5" /> {d.location}
                      </span>
                    )}
                    {d.package && (
                      <span className="flex items-center gap-1 font-medium text-foreground">
                        <Sparkles className="size-3.5 text-primary" /> {d.package}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    onClick={() => setAskDrive(d)}
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                    aria-label={`Ask AI about ${d.company_name}`}
                    title="Ask AI about this drive"
                  >
                    <Bot className="size-4" />
                  </button>
                  {canManage(d) && (
                    <>
                      <button
                        onClick={() => {
                          setEditing(d);
                          setFormOpen(true);
                        }}
                        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        aria-label={`Edit ${d.company_name}`}
                        title="Edit"
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(d)}
                        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        aria-label={`Delete ${d.company_name}`}
                        title="Delete"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Details */}
              {d.description && (
                <p className="mt-3 text-sm text-muted-foreground">{d.description}</p>
              )}
              {d.eligibility && (
                <div className="mt-3 rounded-xl border bg-muted/40 p-3">
                  <p className="text-[10px] font-semibold tracking-widest text-muted-foreground/80 uppercase">
                    Eligibility
                  </p>
                  <p className="mt-1 text-sm">{d.eligibility}</p>
                  {d.my_match?.reason && (
                    <p className="mt-1.5 flex items-start gap-1.5 text-xs text-violet-600 dark:text-violet-400">
                      <TrendingUp className="mt-0.5 size-3.5 shrink-0" />
                      <span>{d.my_match.reason}</span>
                    </p>
                  )}
                </div>
              )}

              {/* Footer */}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
                <div className="text-xs text-muted-foreground">
                  <p
                    className={cn(
                      "flex items-center gap-1.5 font-medium",
                      d.status === "OPEN"
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-destructive"
                    )}
                  >
                    <CalendarDays className="size-3.5" />
                    {d.last_date_to_apply
                      ? d.status === "OPEN"
                        ? `Apply by ${formatDate(d.last_date_to_apply)}`
                        : `Closed on ${formatDate(d.last_date_to_apply)}`
                      : "Apply date not announced"}
                  </p>
                  {d.status === "EXPIRED" && d.expires_at && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground/80">
                      Removed automatically on {formatDate(d.expires_at)}
                    </p>
                  )}
                  {d.posted_by_name && (
                    <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground/80">
                      <Building2 className="size-3" />
                      Posted by {d.posted_by_name}
                      {d.posted_by_role ? ` · ${ROLE_LABELS[d.posted_by_role] ?? "Portal"}` : ""} ·{" "}
                      {formatDate(d.created_at)}
                    </p>
                  )}
                </div>
                <div
                  className="flex items-center gap-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Button size="sm" variant="outline" onClick={() => router.push(`/placements/${d.id}`)}>
                    Details
                  </Button>
                  {d.drive_link ? (
                    <a
                      href={d.drive_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                        d.status === "OPEN"
                          ? "bg-primary text-primary-foreground hover:brightness-110"
                          : "pointer-events-none bg-muted text-muted-foreground"
                      )}
                    >
                      {d.status === "OPEN" ? "Apply" : "Closed"}
                      <ExternalLink className="size-3.5" />
                    </a>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">
                      Contact placement cell
                    </Badge>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <DriveFormDialog open={formOpen} onOpenChange={setFormOpen} editing={editing} />
      <DriveAskDialog
        drive={askDrive}
        open={Boolean(askDrive)}
        onOpenChange={(open) => !open && setAskDrive(null)}
      />

      <DriveAssistant />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete drive"
        description={`Delete ${deleteTarget?.company_name}? Students will no longer see it.`}
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
