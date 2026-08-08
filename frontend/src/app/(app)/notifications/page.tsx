"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BellOff, CheckCheck, Inbox, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { useAuth } from "@/lib/auth";
import { http } from "@/lib/api";
import { notificationKindColor, notificationKindIcon } from "@/lib/notifications";
import type { Notification } from "@/lib/types";
import { cn, formatDate, getErrorMessage, timeAgo } from "@/lib/utils";

type Scope = "all" | "unread";

export default function NotificationsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<Scope>("all");

  const { data: countData } = useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: () => http.get<{ count: number }>("/notifications/unread_count/"),
    enabled: Boolean(user),
  });
  const unread = countData?.count ?? 0;

  const { data: items, isLoading } = useQuery({
    queryKey: ["notifications", "history", scope],
    queryFn: () =>
      http.get<Notification[]>("/notifications/", { scope: scope === "unread" ? "unread" : "all" }),
    enabled: Boolean(user),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
  };

  const openNotification = async (n: Notification) => {
    if (!n.read) {
      await http.post(`/notifications/${n.id}/mark_read/`).catch(() => {});
      invalidate();
    }
    if (n.link) router.push(n.link);
  };

  const markAllRead = async () => {
    try {
      await http.post("/notifications/read_all/");
      invalidate();
      toast.success("All notifications marked as read.");
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  if (!user) return null;

  return (
    <div>
      <PageHeader
        title="Notifications"
        description="Your full history — documents, resumes and admin replies."
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={scope}
          onValueChange={(v) => setScope(v as Scope)}
          className="w-full sm:w-auto"
        >
          <TabsList>
            <TabsTrigger value="all">
              All{items && items.length > 0 ? ` (${items.length})` : ""}
            </TabsTrigger>
            <TabsTrigger value="unread">
              Unread{unread > 0 ? ` (${unread})` : ""}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {unread > 0 && (
          <Button variant="outline" size="sm" onClick={markAllRead}>
            <CheckCheck className="size-4" /> Mark all read
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-24">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      ) : !items || items.length === 0 ? (
        <EmptyState
          icon={scope === "unread" ? BellOff : Inbox}
          title={scope === "unread" ? "You're all caught up" : "No notifications yet"}
          description={
            scope === "unread"
              ? "No unread notifications. New ones will land here."
              : "New documents, resumes and admin replies will show up here."
          }
        />
      ) : (
        <div className="space-y-2">
          {items.map((n) => {
            const Icon = notificationKindIcon(n.kind);
            const color = notificationKindColor(n.kind);
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => openNotification(n)}
                className={cn(
                  "flex w-full items-start gap-3.5 rounded-xl border bg-card p-4 text-left shadow-sm transition-all",
                  !n.read
                    ? "border-primary/30 bg-primary/[0.03] hover:border-primary/50"
                    : "hover:border-primary/30 hover:bg-muted/40"
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl",
                    color
                  )}
                >
                  <Icon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-start justify-between gap-3">
                    <span
                      className={cn(
                        "text-sm",
                        !n.read ? "font-semibold text-foreground" : "font-medium text-foreground"
                      )}
                    >
                      {n.title}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {timeAgo(n.created_at)}
                    </span>
                  </span>
                  {n.message && (
                    <span className="mt-1 block text-sm text-muted-foreground">{n.message}</span>
                  )}
                  <span className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground/80">
                    {!n.read && (
                      <>
                        <span className="size-1.5 rounded-full bg-primary" />
                        <span className="font-medium text-primary">Unread</span>
                      </>
                    )}
                    <span>{formatDate(n.created_at)}</span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
