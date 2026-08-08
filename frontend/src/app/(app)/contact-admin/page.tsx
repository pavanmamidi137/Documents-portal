"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Clock,
  Loader2,
  MessageSquareText,
  Send,
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { useAuth } from "@/lib/auth";
import { http } from "@/lib/api";
import type { ContactRequest } from "@/lib/types";
import { formatDate, getErrorMessage } from "@/lib/utils";

export default function ContactAdminPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = user?.is_super_admin ?? false;
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  const { data: requests, isLoading } = useQuery({
    queryKey: ["contact-requests"],
    queryFn: () => http.get<ContactRequest[]>("/contact-requests/"),
  });

  const send = useMutation({
    mutationFn: () => http.post<ContactRequest>("/contact-requests/", { subject, message }),
    onSuccess: () => {
      toast.success(isAdmin ? "Request created." : "Message sent to the admin — they've been notified.");
      setSubject("");
      setMessage("");
      queryClient.invalidateQueries({ queryKey: ["contact-requests"] });
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const resolve = useMutation({
    mutationFn: (id: number) => http.post<ContactRequest>(`/contact-requests/${id}/resolve/`),
    onSuccess: () => {
      toast.success("Request marked as resolved.");
      queryClient.invalidateQueries({ queryKey: ["contact-requests"] });
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const canSend = Boolean(user?.is_faculty || user?.is_cr);

  return (
    <RoleGuard roles={["FACULTY", "CR", "SUPER_ADMIN"]}>
      <PageHeader
        title={isAdmin ? "Contact Requests" : "Contact Admin"}
        description={
          isAdmin
            ? "Messages from faculty and CRs — resolve them once handled."
            : "Reach out to the admin with any issue or request. You'll get a reply right here."
        }
      />

      <div className="grid gap-6 lg:grid-cols-5">
        {canSend && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquareText className="size-5 text-primary" /> Send a message
              </CardTitle>
              <CardDescription>
                The admin is notified instantly when you send a message.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="contact-subject">Subject</Label>
                <Input
                  id="contact-subject"
                  placeholder="e.g. Need a new subject added for 4-1"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  maxLength={150}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contact-message">Message</Label>
                <Textarea
                  id="contact-message"
                  placeholder="Describe your request or issue…"
                  rows={5}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </div>
              <Button
                className="w-full"
                onClick={() => send.mutate()}
                disabled={send.isPending || subject.trim().length === 0 || message.trim().length === 0}
              >
                {send.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                Send to Admin
              </Button>
            </CardContent>
          </Card>
        )}

        <div className={canSend ? "lg:col-span-3" : "lg:col-span-5"}>
          <Card>
            <CardHeader>
              <CardTitle>
                {isAdmin ? "All messages" : "Your messages"}
              </CardTitle>
              <CardDescription>
                {isAdmin
                  ? "Everything faculty and CRs have sent you, newest first."
                  : "Track the status of everything you've sent."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="size-6 animate-spin text-primary" />
                </div>
              ) : !requests || requests.length === 0 ? (
                <EmptyState
                  icon={MessageSquareText}
                  title="No messages yet"
                  description={
                    isAdmin
                      ? "Messages from faculty and CRs will appear here."
                      : "Messages you send to the admin will appear here."
                  }
                />
              ) : (
                <div className="space-y-3">
                  {requests.map((r) => (
                    <div
                      key={r.id}
                      className="rounded-xl border bg-card p-4 transition-colors hover:border-primary/30"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium">{r.subject}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {isAdmin && (
                              <>
                                {r.sender_name} ({r.sender_roll} · {r.sender_role}) —{" "}
                              </>
                            )}
                            {formatDate(r.created_at)}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Badge
                            variant="outline"
                            className={
                              r.status === "RESOLVED"
                                ? "gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                : "gap-1 border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                            }
                          >
                            {r.status === "RESOLVED" ? (
                              <CheckCircle2 className="size-3" />
                            ) : (
                              <Clock className="size-3" />
                            )}
                            {r.status_label}
                          </Badge>
                          {isAdmin && r.status === "PENDING" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => resolve.mutate(r.id)}
                              disabled={resolve.isPending}
                            >
                              Mark resolved
                            </Button>
                          )}
                        </div>
                      </div>
                      <p className="mt-2 text-sm whitespace-pre-wrap text-muted-foreground">
                        {r.message}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </RoleGuard>
  );
}
