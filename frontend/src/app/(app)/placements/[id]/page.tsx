"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Bot,
  Briefcase,
  Building2,
  CalendarDays,
  CheckCircle2,
  ExternalLink,
  GraduationCap,
  Loader2,
  MapPin,
  Send,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { http } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Drive, DriveChatMessage } from "@/lib/types";
import { cn, formatDate, getErrorMessage } from "@/lib/utils";

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

interface Message {
  role: "user" | "assistant";
  text: string;
}

const QUICK_PROMPTS = [
  "Am I eligible for this drive?",
  "What does this drive offer?",
  "When is the last date to apply?",
  "What is the selection process?",
];

export default function DriveDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const driveId = Number(params.id);

  const { data: drive, isLoading } = useQuery({
    queryKey: ["drives", "detail", driveId],
    queryFn: () => http.get<Drive>(`/drives/${driveId}/`),
    enabled: Number.isFinite(driveId),
  });

  // Opening the drive (this detail page) clears unread DRIVE notifications -
  // the count only drops when the student actually opens and views the drive.
  useEffect(() => {
    if (Number.isFinite(driveId)) {
      http
        .post("/notifications/mark_kind_read/", { kind: "DRIVE" })
        .then(() => queryClient.invalidateQueries({ queryKey: ["notifications", "unread-count"] }))
        .catch(() => {
          /* best-effort - the bell also reconciles on its next poll */
        });
    }
  }, [driveId, queryClient]);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 py-6">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-10 w-72" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-32 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!drive) {
    return (
      <div className="py-16">
        <EmptyState
          icon={Briefcase}
          title="Drive not found"
          description="This drive may have been removed after its 30-day expiry window."
        />
        <div className="mt-6 flex justify-center">
          <Button variant="outline" onClick={() => router.push("/placements")}>
            <ArrowLeft className="size-4" /> Back to Placements
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/placements"
        className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> All drives
      </Link>

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="relative overflow-hidden rounded-2xl border bg-card p-6 shadow-sm sm:p-8"
      >
        <div className="pointer-events-none absolute -top-24 -right-24 size-64 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 blur-3xl" />
        <div className="relative flex items-start gap-4">
          <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/60 text-2xl font-bold text-primary-foreground shadow-lg shadow-primary/25">
            {drive.company_name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{drive.company_name}</h1>
              {drive.job_type && (
                <Badge
                  variant="outline"
                  className={
                    drive.job_type === "INTERNSHIP"
                      ? "gap-1 border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400"
                      : "gap-1 border-primary/30 bg-primary/10 text-primary"
                  }
                >
                  {drive.job_type === "INTERNSHIP" ? (
                    <GraduationCap className="size-3" />
                  ) : (
                    <Briefcase className="size-3" />
                  )}
                  {drive.job_type === "INTERNSHIP" ? "Internship" : "Job"}
                </Badge>
              )}
              <Badge
                variant="outline"
                className={cn(
                  drive.status === "OPEN"
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "border-muted-foreground/20 bg-muted text-muted-foreground"
                )}
              >
                {drive.status === "OPEN" ? "Open" : "Expired"}
              </Badge>
              {drive.is_eligible_for_me === true && (
                <Badge className="border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="size-3" /> Eligible for you
                </Badge>
              )}
              {drive.my_match && (
                <Badge
                  variant="outline"
                  className={`gap-1 ${matchClasses(drive.my_match.score)}`}
                  title={drive.my_match.reason || "AI match estimate from your resume"}
                >
                  <TrendingUp className="size-3" /> {drive.my_match.score}% match
                </Badge>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {drive.role && (
                <span className="flex items-center gap-1.5">
                  <Briefcase className="size-4" /> {drive.role}
                </span>
              )}
              {drive.location && (
                <span className="flex items-center gap-1.5">
                  <MapPin className="size-4" /> {drive.location}
                </span>
              )}
              {drive.package && (
                <span className="flex items-center gap-1.5 font-medium text-foreground">
                  <Sparkles className="size-4 text-primary" /> {drive.package}
                </span>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <CalendarDays className="size-3.5" />
                {drive.last_date_to_apply
                  ? drive.status === "OPEN"
                    ? `Apply by ${formatDate(drive.last_date_to_apply)}`
                    : `Closed on ${formatDate(drive.last_date_to_apply)}`
                  : "Apply date not announced"}
              </span>
              {drive.status === "EXPIRED" && drive.expires_at && (
                <span>Removed automatically on {formatDate(drive.expires_at)}</span>
              )}
              {drive.posted_by_name && (
                <span className="flex items-center gap-1.5">
                  <Building2 className="size-3.5" />
                  Posted by {drive.posted_by_name}
                  {drive.posted_by_role ? ` · ${ROLE_LABELS[drive.posted_by_role] ?? "Portal"}` : ""} ·{" "}
                  {formatDate(drive.created_at)}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Apply button - beside the details for students */}
        <div className="relative mt-6 flex flex-wrap items-center gap-3 border-t pt-5">
          {drive.drive_link ? (
            <a
              href={drive.drive_link}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all",
                drive.status === "OPEN"
                  ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25 hover:brightness-110"
                  : "pointer-events-none bg-muted text-muted-foreground"
              )}
            >
              {drive.status === "OPEN" ? "Apply Now" : "Closed"}
              <ExternalLink className="size-4" />
            </a>
          ) : (
            <Badge variant="outline" className="px-3 py-1.5 text-muted-foreground">
              Contact placement cell to apply
            </Badge>
          )}
          {drive.status === "OPEN" && drive.drive_link && (
            <p className="text-xs text-muted-foreground">
              You&apos;ll be taken to the company&apos;s application page.
            </p>
          )}
        </div>
      </motion.div>

      {/* Details grid */}
      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        {drive.description && (
          <Card className="sm:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">About the drive</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                {drive.description}
              </p>
            </CardContent>
          </Card>
        )}

        {drive.eligibility && (
          <Card className="sm:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Eligibility</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                {drive.eligibility}
              </p>
              {drive.my_match?.reason && (
                <p className="flex items-start gap-1.5 rounded-xl border bg-violet-500/10 p-3 text-xs text-violet-600 dark:text-violet-400">
                  <TrendingUp className="mt-0.5 size-3.5 shrink-0" />
                  <span>{drive.my_match.reason}</span>
                </p>
              )}
              {drive.eligible_roll_numbers && (
                <p className="text-xs text-muted-foreground">
                  The company also shared a pre-approved roll-number list for this drive.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {!drive.description && !drive.eligibility && (
          <p className="text-sm text-muted-foreground">
            No additional details were shared for this drive yet — contact the placement cell.
          </p>
        )}
      </div>

      {/* AI chatbot beside the details */}
      <DriveDetailChat drive={drive} user={user} />
    </div>
  );
}

function DriveDetailChat({
  drive,
  user,
}: {
  drive: Drive;
  user: {
    is_student?: boolean;
    is_cr?: boolean;
    roll_number?: string;
    branch_name?: string | null;
  } | null;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const loadedRef = useRef(false);

  // Load the saved conversation for this drive (it survives even after the
  // drive expires - the chat belongs to this specific drive only).
  useEffect(() => {
    if (loadedRef.current || !Number.isFinite(drive.id)) return;
    loadedRef.current = true;
    http
      .get<{ messages: DriveChatMessage[] }>(`/drives/${drive.id}/chat_history/`)
      .then((data) =>
        setMessages(data.messages.map((m) => ({ role: m.role, text: m.content })))
      )
      .catch(() => {
        /* best-effort - a fresh conversation is fine */
      });
  }, [drive.id]);

  const ask = async (raw?: string) => {
    const text = (raw ?? question).trim();
    if (!text || asking) return;
    setQuestion("");
    setMessages((prev) => [...prev, { role: "user", text }]);
    setAsking(true);
    try {
      const data = await http.post<{ answer: string }>(`/drives/${drive.id}/ai_ask/`, {
        question: text,
      });
      setMessages((prev) => [...prev, { role: "assistant", text: data.answer }]);
    } catch (error) {
      toast.error(getErrorMessage(error));
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: "Sorry, I couldn't answer that right now." },
      ]);
    } finally {
      setAsking(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.05 }}
      className="mt-8 overflow-hidden rounded-2xl border bg-card shadow-sm"
    >
      <div className="flex items-center gap-3 border-b bg-primary/5 px-5 py-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/60 text-primary-foreground shadow-sm shadow-primary/20">
          <Bot className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Ask about this drive</p>
          <p className="text-xs text-muted-foreground">
            {user?.is_student || user?.is_cr
              ? `I know you're ${user.roll_number} · ${user.branch_name ?? "—"} — ask anything about eligibility.`
              : "Eligibility, package, selection process — ask away."}
          </p>
        </div>
      </div>

      <div className="space-y-3 px-5 py-4">
        {messages.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {QUICK_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => ask(prompt)}
                disabled={asking}
                className="rounded-full border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
              >
                {prompt}
              </button>
            ))}
          </div>
        )}

        {messages.map((m, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
          >
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm",
                m.role === "user"
                  ? "rounded-br-sm bg-primary text-primary-foreground"
                  : "rounded-bl-sm border bg-muted/40"
              )}
            >
              {m.text}
            </div>
          </motion.div>
        ))}

        {asking && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin text-primary" /> Thinking…
          </div>
        )}
      </div>

      <div className="flex gap-2 border-t p-3">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ask()}
          placeholder={`Ask about ${drive.company_name}…`}
          disabled={asking}
          className="h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
        />
        <Button size="icon" onClick={() => ask()} disabled={asking} aria-label="Ask">
          <Send className="size-4" />
        </Button>
      </div>
    </motion.div>
  );
}
