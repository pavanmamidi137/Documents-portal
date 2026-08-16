"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Lightbulb,
  Loader2,
  MessageSquareText,
  Send,
  ThumbsDown,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { RoleGuard } from "@/components/role-guard";
import { PageHeader } from "@/components/layout/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/empty-state";
import { useAuth } from "@/lib/auth";
import { http } from "@/lib/api";
import type { Feedback, FeedbackStatus, Paginated } from "@/lib/types";
import { cn, formatDateTime, getErrorMessage } from "@/lib/utils";

const STATUS_STYLES: Record<FeedbackStatus, string> = {
  NEW: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  APPROVED: "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30",
  IMPLEMENTED: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  DECLINED: "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30",
};

const STATUS_FILTERS: Array<"ALL" | FeedbackStatus> = [
  "ALL",
  "NEW",
  "APPROVED",
  "IMPLEMENTED",
  "DECLINED",
];

export default function FeedbackPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = user?.is_super_admin ?? false;

  const [kind, setKind] = useState<"IDEA" | "FEEDBACK">("IDEA");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | FeedbackStatus>("ALL");
  const [kindFilter, setKindFilter] = useState<"ALL" | "IDEA" | "FEEDBACK">("ALL");

  const { data, isLoading } = useQuery({
    queryKey: ["feedback", isAdmin ? "admin" : "mine", statusFilter, kindFilter],
    queryFn: () =>
      http.get<Paginated<Feedback>>("/feedback/", {
        ...(statusFilter !== "ALL" ? { status: statusFilter } : {}),
        ...(kindFilter !== "ALL" ? { kind: kindFilter } : {}),
      }),
  });
  const items = data?.results ?? [];

  const submit = useMutation({
    mutationFn: () =>
      http.post<Feedback>("/feedback/", {
        kind,
        title: title.trim(),
        message: message.trim(),
      }),
    onSuccess: () => {
      toast.success(
        kind === "IDEA"
          ? "Thanks! Your idea is with the admin — if it gets built, you'll see it under 'Built from your ideas'."
          : "Thanks for the feedback — the admin has been notified."
      );
      setTitle("");
      setMessage("");
      queryClient.invalidateQueries({ queryKey: ["feedback"] });
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: FeedbackStatus }) =>
      http.patch<Feedback>(`/feedback/${id}/`, { status }),
    onSuccess: (updated) => {
      toast.success(`Marked as ${updated.status_label}.`);
      queryClient.invalidateQueries({ queryKey: ["feedback"] });
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (id: number) => http.delete(`/feedback/${id}/`),
    onSuccess: () => {
      toast.success("Entry deleted.");
      queryClient.invalidateQueries({ queryKey: ["feedback"] });
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const counts = useMemo(() => {
    const all = data?.count ?? 0;
    return { all };
  }, [data]);

  return (
    <RoleGuard roles={["SUPER_ADMIN", "CR", "FACULTY", "STUDENT"]}>
      <PageHeader
        title={isAdmin ? "Feedback & Ideas" : "Feedback & Ideas"}
        description={
          isAdmin
            ? "What students are saying — approve the good ideas, mark them implemented when they ship."
            : "Share feedback or a feature idea. Ideas that get built are shown on the home page with your name."
        }
      />

      <div className="grid gap-6 lg:grid-cols-5">
        {!isAdmin && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lightbulb className="size-5 text-primary" /> Share your idea or feedback
              </CardTitle>
              <CardDescription>
                Your name is attached automatically, so you get credit when your idea goes live.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setKind("IDEA")}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors",
                    kind === "IDEA"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-muted"
                  )}
                >
                  <Lightbulb className="size-4" /> Idea
                </button>
                <button
                  type="button"
                  onClick={() => setKind("FEEDBACK")}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors",
                    kind === "FEEDBACK"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-muted"
                  )}
                >
                  <MessageSquareText className="size-4" /> Feedback
                </button>
              </div>
              <div className="space-y-2">
                <Label htmlFor="feedback-title">
                  Title <span className="text-muted-foreground">(optional — for ideas)</span>
                </Label>
                <Input
                  id="feedback-title"
                  placeholder={kind === "IDEA" ? "e.g. Dark mode for the document viewer" : "Short summary"}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={150}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="feedback-message">
                  {kind === "IDEA" ? "Describe your idea" : "Your feedback"}
                </Label>
                <Textarea
                  id="feedback-message"
                  placeholder={
                    kind === "IDEA"
                      ? "What would make PlaceMate better? Be as specific as you can…"
                      : "What went well, or what could be better…"
                  }
                  rows={5}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </div>
              <Button
                className="w-full"
                onClick={() => submit.mutate()}
                disabled={submit.isPending || message.trim().length === 0}
              >
                {submit.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                Submit
              </Button>
              <p className="text-center text-[11px] text-muted-foreground">
                Submitting as <b className="text-foreground">{user?.full_name}</b>
                {user?.roll_number ? ` (${user.roll_number})` : ""}
              </p>
            </CardContent>
          </Card>
        )}

        <div className={cn("space-y-4", isAdmin ? "lg:col-span-5" : "lg:col-span-3")}>
          {isAdmin && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap gap-1.5 rounded-xl border bg-card p-1">
                {STATUS_FILTERS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatusFilter(s)}
                    className={cn(
                      "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                      statusFilter === s
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    {s === "ALL" ? `All (${counts.all})` : s.charAt(0) + s.slice(1).toLowerCase()}
                  </button>
                ))}
              </div>
              <div className="flex gap-1.5 rounded-xl border bg-card p-1">
                {(["ALL", "IDEA", "FEEDBACK"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKindFilter(k)}
                    className={cn(
                      "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                      kindFilter === k
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    {k === "ALL" ? "All types" : k === "IDEA" ? "💡 Ideas" : "💬 Feedback"}
                  </button>
                ))}
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="size-6 animate-spin text-primary" />
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              icon={Lightbulb}
              title={isAdmin ? "No submissions yet" : "No submissions yet"}
              description={
                isAdmin
                  ? "When students share feedback or ideas, they'll show up here."
                  : "When you share an idea or feedback, it'll show up here with its status."
              }
            />
          ) : (
            <div className="space-y-3">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="rounded-2xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant="outline"
                      className={cn(
                        item.kind === "IDEA"
                          ? "bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/30"
                          : "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30"
                      )}
                    >
                      {item.kind === "IDEA" ? "💡 Idea" : "💬 Feedback"}
                    </Badge>
                    <Badge variant="outline" className={STATUS_STYLES[item.status]}>
                      {item.status === "IMPLEMENTED" ? "✓ " : ""}
                      {item.status_label}
                    </Badge>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {formatDateTime(item.created_at)}
                    </span>
                  </div>

                  {item.title && (
                    <p className="mt-2.5 font-semibold">{item.title}</p>
                  )}
                  <p className="mt-1 text-sm text-muted-foreground">{item.message}</p>

                  {(isAdmin || item.user === user?.id) && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3 text-xs">
                      {isAdmin ? (
                        <>
                          <span className="font-medium text-foreground">
                            {item.user_name}
                            {item.user_roll && (
                              <span className="text-muted-foreground"> · {item.user_roll}</span>
                            )}
                            {item.user_role && (
                              <span className="text-muted-foreground"> · {item.user_role}</span>
                            )}
                          </span>
                          <div className="ml-auto flex flex-wrap gap-1.5">
                            {item.status === "NEW" && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setStatus.mutate({ id: item.id, status: "APPROVED" })}
                                disabled={setStatus.isPending}
                              >
                                Approve
                              </Button>
                            )}
                            {item.status !== "IMPLEMENTED" && (
                              <Button
                                size="sm"
                                className="bg-emerald-600 text-white hover:bg-emerald-700"
                                onClick={() => setStatus.mutate({ id: item.id, status: "IMPLEMENTED" })}
                                disabled={setStatus.isPending}
                              >
                                <CheckCircle2 className="size-4" /> Implement
                              </Button>
                            )}
                            {item.status !== "DECLINED" && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-muted-foreground"
                                onClick={() => setStatus.mutate({ id: item.id, status: "DECLINED" })}
                                disabled={setStatus.isPending}
                              >
                                <ThumbsDown className="size-4" /> Decline
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-destructive/40 text-destructive hover:bg-destructive/10"
                              onClick={() => remove.mutate(item.id)}
                              disabled={remove.isPending}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        </>
                      ) : (
                        <span className="text-muted-foreground">
                          {item.status === "IMPLEMENTED"
                            ? "✓ Your idea went live — thank you! It's featured on the home page with your name."
                            : item.status === "DECLINED"
                              ? "This was declined — keep the ideas coming though!"
                              : "The admin is reviewing this."}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </RoleGuard>
  );
}
