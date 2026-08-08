"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Bell, CheckCheck, Inbox, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/empty-state";
import { useAuth } from "@/lib/auth";
import { http } from "@/lib/api";
import { notificationKindColor, notificationKindIcon } from "@/lib/notifications";
import type { Notification } from "@/lib/types";
import { cn, formatDate, getErrorMessage } from "@/lib/utils";

/** Bell in the top bar: unread badge + dropdown of the user's notifications. */
export function NotificationsBell() {
  const { user } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const enabled = Boolean(user);

  // Lightweight count polled in the background for the badge.
  const { data: countData } = useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: () => http.get<{ count: number }>("/notifications/unread_count/"),
    enabled,
    refetchInterval: 30_000,
  });

  // Full list loads lazily when the dropdown opens.
  const { data: items, isLoading } = useQuery({
    queryKey: ["notifications", "list"],
    queryFn: () => http.get<Notification[]>("/notifications/", { page_size: 10 }),
    enabled: enabled && open,
  });

  const unread = countData?.count ?? 0;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
  };

  const openNotification = async (n: Notification) => {
    if (!n.read) {
      await http.post(`/notifications/${n.id}/mark_read/`).catch(() => {
        /* best-effort - the badge will reconcile on the next poll */
      });
      invalidate();
    }
    setOpen(false);
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

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
            title="Notifications"
            className="relative text-muted-foreground"
          >
            <Bell className="size-5" />
            {unread > 0 && (
              <span className="absolute top-1 right-1 flex size-4 min-w-4 items-center justify-center rounded-full bg-destructive px-0.5 text-[9px] font-bold text-white">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center justify-between px-2 py-2">
            <span className="text-sm font-semibold text-foreground">Notifications</span>
            {unread > 0 && (
              <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={markAllRead}>
                <CheckCheck className="size-3.5" /> Mark all read
              </Button>
            )}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />

        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        ) : !items || items.length === 0 ? (
          <div className="py-6">
            <EmptyState
              icon={Inbox}
              title="No notifications yet"
              description="New documents, resumes and admin replies will show up here."
            />
          </div>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            {items.map((n) => {
              const Icon = notificationKindIcon(n.kind);
              const color = notificationKindColor(n.kind);
              return (
                <DropdownMenuItem
                  key={n.id}
                  className="flex items-start gap-3 rounded-lg px-2 py-2.5"
                  onClick={() => openNotification(n)}
                >
                  <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg", color)}>
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className={cn("truncate text-sm font-medium", !n.read && "font-semibold")}>
                        {n.title}
                      </span>
                      {!n.read && <span className="size-1.5 shrink-0 rounded-full bg-primary" />}
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                      {n.message}
                    </span>
                    <span className="mt-1 block text-[10px] text-muted-foreground/80">
                      {formatDate(n.created_at)}
                    </span>
                  </span>
                </DropdownMenuItem>
              );
            })}
          </div>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="justify-center py-2.5"
          onClick={() => {
            setOpen(false);
            router.push("/notifications");
          }}
        >
          <span className="flex items-center gap-1.5 text-sm font-medium text-primary">
            <ArrowRight className="size-4" /> View all notifications
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
