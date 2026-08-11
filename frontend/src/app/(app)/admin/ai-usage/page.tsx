"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  BrainCircuit,
  CalendarRange,
  ChevronDown,
  ChevronRight,
  Coins,
  Loader2,
  Save,
  Search,
  Star,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";

import { RoleGuard } from "@/components/role-guard";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/stat-card";
import { EmptyState } from "@/components/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { http } from "@/lib/api";
import type { AiUsageData, AiUsageUser } from "@/lib/types";
import { cn, getErrorMessage } from "@/lib/utils";

interface DailyTooltipEntry {
  dataKey?: string | number;
  value?: number | string | (number | string)[];
}

/** 0-100 AI score -> 0-5 stars (matches the student resume page). */
function scoreToStars(score: number | null): number {
  if (score == null) return 0;
  return Math.min(5, Math.max(0, Math.round(score / 10) / 2));
}

function scoreTone(score: number | null) {
  if (score == null) return "text-muted-foreground";
  if (score >= 70) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 45) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function matchBarTone(score: number) {
  if (score >= 70) return "bg-emerald-500";
  if (score >= 45) return "bg-amber-500";
  return "bg-red-500";
}

function StarRating({ score }: { score: number | null }) {
  const stars = scoreToStars(score);
  return (
    <div className="flex items-center gap-0.5" aria-label={`${stars} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => {
        const filled = stars >= i;
        const half = !filled && stars >= i - 0.5;
        return (
          <Star
            key={i}
            className={
              filled
                ? "size-4 fill-amber-400 text-amber-400"
                : half
                  ? "size-4 fill-amber-400/40 text-amber-400"
                  : "size-4 text-muted-foreground/40"
            }
          />
        );
      })}
      <span className="ml-1.5 text-xs font-semibold tabular-nums">{stars.toFixed(1)}</span>
    </div>
  );
}

function DailyTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: DailyTooltipEntry[];
  label?: React.ReactNode;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const day = new Date(`${String(label)}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return (
    <div className="rounded-xl border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
      <p className="mb-1 font-semibold">{day}</p>
      {payload.map((entry) => {
        const raw = entry.value;
        const value = Array.isArray(raw) ? raw[0] : raw;
        return (
          <p key={String(entry.dataKey ?? "")} className="flex items-center gap-2 tabular-nums">
            <span className="size-2 rounded-full bg-primary" />
            {entry.dataKey === "tokens" ? "Tokens" : "Calls"}: {Number(value ?? 0).toLocaleString()}
          </p>
        );
      })}
    </div>
  );
}

export default function AiUsagePage() {
  const queryClient = useQueryClient();
  const [budgetInput, setBudgetInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [studentSearch, setStudentSearch] = useState("");

  const toggleExpanded = (userId: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const { data, isLoading } = useQuery({
    queryKey: ["ai-usage"],
    queryFn: () => http.get<AiUsageData>("/drives/ai_usage/"),
  });

  // Pre-fill the budget box with the current value once it loads, so saving
  // without typing never wipes the existing budget.
  useEffect(() => {
    if (data && budgetInput === "" && data.budget_tokens != null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time pre-fill from the query result
      setBudgetInput(String(data.budget_tokens));
    }
  }, [data, budgetInput]);

  const saveBudget = async () => {
    if (budgetInput.trim() === "") {
      toast.error("Enter a budget first (0 disables tracking).");
      return;
    }
    const value = Number(budgetInput);
    if (!Number.isFinite(value) || value < 0) {
      toast.error("Enter a valid number of tokens (0 to disable).");
      return;
    }
    setSaving(true);
    try {
      await http.post("/drives/ai_budget/", { budget_tokens: Math.round(value) });
      toast.success("Monthly AI budget updated.");
      queryClient.invalidateQueries({ queryKey: ["ai-usage"] });
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const totals = data?.totals;
  const used = totals?.used_tokens ?? 0;
  const budget = data?.budget_tokens ?? 0;
  const percent = data?.percent_used;
  const remaining = data?.remaining_tokens;
  const totalAcrossUsers = data?.per_user.reduce((sum, u) => sum + u.total_tokens, 0) ?? 0;

  const filteredUsers = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    if (!q) return data?.per_user ?? [];
    return (data?.per_user ?? []).filter(
      (u) =>
        u.roll_number.toLowerCase().includes(q) ||
        u.name.toLowerCase().includes(q)
    );
  }, [data?.per_user, studentSearch]);

  return (
    <RoleGuard roles={["SUPER_ADMIN"]}>
      <div>
        <PageHeader
          title="AI Usage & Credits"
          description="Who is using the Gemini credits, how many tokens were spent, and what's left of the monthly budget."
        />

        {isLoading ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-2xl border bg-card p-5">
                <Skeleton className="mb-3 h-4 w-24" />
                <Skeleton className="h-8 w-16" />
              </div>
            ))}
          </div>
        ) : (
          <>
            {/* ------------------------------------------------ Stat cards */}
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <StatCard label="AI Calls" value={totals?.calls ?? 0} icon={BrainCircuit} gradient="from-primary to-primary/60" />
              <StatCard label="Tokens Used" value={used} icon={Coins} gradient="from-amber-500 to-orange-600" />
              <StatCard
                label="Monthly Budget"
                value={budget > 0 ? budget.toLocaleString() : "Not set"}
                icon={Coins}
                gradient="from-sky-500 to-cyan-600"
              />
              <StatCard
                label="Remaining"
                value={data?.remaining_tokens == null ? "—" : data.remaining_tokens.toLocaleString()}
                icon={Coins}
                gradient="from-emerald-500 to-teal-600"
              />
            </div>

            {/* ------------------------------------------------ Daily usage chart */}
            <div className="mt-6 rounded-2xl border bg-card p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="flex items-center gap-2 font-semibold">
                    <CalendarRange className="size-4 text-primary" /> Daily usage
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Tokens consumed per day over the last 30 days.
                  </p>
                </div>
                <Badge variant="outline" className="tabular-nums">
                  {(data?.daily ?? []).reduce((sum, d) => sum + d.tokens, 0).toLocaleString()} tokens
                </Badge>
              </div>
              {!data?.daily || data.daily.every((d) => d.tokens === 0) ? (
                <div className="flex h-56 items-center justify-center rounded-xl border border-dashed">
                  <p className="text-sm text-muted-foreground">No AI usage in the last 30 days yet.</p>
                </div>
              ) : (
                <div className="h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.daily} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(value: string) => {
                          const d = new Date(`${value}T00:00:00`);
                          return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
                        }}
                        tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                        tickLine={false}
                        axisLine={false}
                        minTickGap={24}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                        tickLine={false}
                        axisLine={false}
                        allowDecimals={false}
                      />
                      <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} content={<DailyTooltip />} />
                      <Bar dataKey="calls" fill="var(--primary)" opacity={0.35} radius={[6, 6, 0, 0]} stackId="usage" />
                      <Bar dataKey="tokens" fill="var(--primary)" radius={[6, 6, 0, 0]} stackId="usage" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* ------------------------------------------------ Budget + bar */}
            <div className="mt-6 rounded-2xl border bg-card p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="min-w-0 flex-1">
                  <Label htmlFor="budget">Monthly AI credit budget (in tokens)</Label>
                  <div className="mt-2 flex max-w-md gap-2">
                    <Input
                      id="budget"
                      type="number"
                      min={0}
                      placeholder={budget > 0 ? budget.toLocaleString() : "e.g. 100000"}
                      value={budgetInput}
                      onChange={(e) => setBudgetInput(e.target.value)}
                    />
                    <Button onClick={saveBudget} disabled={saving}>
                      {saving && <Loader2 className="size-4 animate-spin" />}
                      <Save className="size-4" /> Save
                    </Button>
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    1 credit ≈ 1,000 tokens. Set 0 to disable the budget tracking.
                  </p>
                </div>
                {percent != null && (
                  <div className="w-full sm:w-72">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">Consumed</span>
                      <span className={cn("font-semibold tabular-nums", percent > 90 ? "text-destructive" : percent > 70 ? "text-amber-600" : "text-emerald-600")}>
                        {percent}%
                      </span>
                    </div>
                    <div className="mt-2 h-3 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          percent > 90
                            ? "bg-destructive"
                            : percent > 70
                              ? "bg-amber-500"
                              : "bg-emerald-500"
                        )}
                        style={{ width: `${Math.min(100, percent)}%` }}
                      />
                    </div>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {used.toLocaleString()} of {budget.toLocaleString()} tokens used ·{" "}
                      {remaining?.toLocaleString() ?? "—"} left
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* ------------------------------------------------ Per-user table */}
            <div className="mt-6 rounded-2xl border bg-card">
              <div className="flex flex-col gap-3 border-b px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h3 className="font-semibold">Usage by Student</h3>
                  <p className="text-xs text-muted-foreground">
                    How many AI credits each account has consumed so far. Expand a
                    student to see their resume AI review (rating, ATS score,
                    summary and any error) — Super Admin only.
                  </p>
                </div>
                {data?.per_user?.length ? (
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={studentSearch}
                        onChange={(e) => setStudentSearch(e.target.value)}
                        placeholder="Search by roll number or name…"
                        className="h-9 w-64 max-w-full pl-8"
                      />
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {filteredUsers.length} of {data.per_user.length}
                    </span>
                  </div>
                ) : null}
              </div>
              {!data?.per_user || data.per_user.length === 0 ? (
                <div className="py-8">
                  <EmptyState
                    icon={BrainCircuit}
                    title="No AI usage yet"
                    description="Token usage will appear here once students and staff start using the AI features."
                  />
                </div>
              ) : filteredUsers.length === 0 ? (
                <div className="py-8">
                  <EmptyState
                    icon={Search}
                    title="No students match your search"
                    description={`Nothing matches "${studentSearch.trim()}". Try a different roll number or name.`}
                  />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10" />
                        <TableHead className="w-12">#</TableHead>
                        <TableHead>Student</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead className="text-right">Calls</TableHead>
                        <TableHead className="text-right">Prompt</TableHead>
                        <TableHead className="text-right">Output</TableHead>
                        <TableHead className="text-right">Total tokens</TableHead>
                        <TableHead className="text-right">Credits</TableHead>
                        <TableHead className="text-right">Share</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredUsers.map((u, i) => {
                        const isOpen = expanded.has(u.user_id);
                        return (
                          <ResumeUsageRow
                            key={u.user_id}
                            user={u}
                            index={i}
                            isOpen={isOpen}
                            onToggle={() => toggleExpanded(u.user_id)}
                            totalAcrossUsers={totalAcrossUsers}
                          />
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </RoleGuard>
  );
}

function ResumeUsageRow({
  user,
  index,
  isOpen,
  onToggle,
  totalAcrossUsers,
}: {
  user: AiUsageUser;
  index: number;
  isOpen: boolean;
  onToggle: () => void;
  totalAcrossUsers: number;
}) {
  const resume = user.resume;
  const analysis = resume?.ai_analysis ?? null;
  const matches = resume?.ai_match
    ? Object.entries(resume.ai_match)
        .filter(([, m]) => typeof m.score === "number")
        .sort((a, b) => b[1].score - a[1].score)
        .slice(0, 4)
    : [];
  return (
    <>
      <TableRow className="cursor-pointer" onClick={onToggle}>
        <TableCell>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label={isOpen ? "Collapse AI review" : "Expand AI review"}
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
          >
            {isOpen ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>
        </TableCell>
        <TableCell className="text-muted-foreground">{index + 1}</TableCell>
        <TableCell>
          <span className="font-medium">{user.name}</span>
          <span className="block font-mono text-xs text-muted-foreground">
            {user.roll_number}
          </span>
        </TableCell>
        <TableCell>
          <Badge variant="outline">{user.role || "—"}</Badge>
        </TableCell>
        <TableCell className="text-right tabular-nums">{user.calls}</TableCell>
        <TableCell className="text-right tabular-nums">
          {user.prompt_tokens.toLocaleString()}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {user.completion_tokens.toLocaleString()}
        </TableCell>
        <TableCell className="text-right font-semibold tabular-nums">
          {user.total_tokens.toLocaleString()}
        </TableCell>
        <TableCell className="text-right tabular-nums text-muted-foreground">
          {Math.ceil(user.total_tokens / 1000).toLocaleString()}
        </TableCell>
        <TableCell className="text-right tabular-nums text-muted-foreground">
          {totalAcrossUsers > 0
            ? `${Math.round((user.total_tokens / totalAcrossUsers) * 100)}%`
            : "—"}
        </TableCell>
      </TableRow>
      {isOpen && (
        <TableRow className="bg-muted/30">
          <TableCell colSpan={10} className="p-0">
            <div className="grid gap-4 border-t px-5 py-4 lg:grid-cols-[240px_1fr]">
              {/* Verdict column */}
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  {!resume ? (
                    <Badge variant="outline" className="bg-muted text-muted-foreground">No resume</Badge>
                  ) : resume.ai_status === "COMPLETE" ? (
                    <Badge variant="outline" className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                      Analyzed
                    </Badge>
                  ) : resume.ai_status === "FAILED" ? (
                    <Badge variant="outline" className="bg-red-500/15 text-red-600 dark:text-red-400">
                      Analysis failed
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-amber-500/15 text-amber-600 dark:text-amber-400">
                      Pending
                    </Badge>
                  )}
                  {resume?.ai_analyzed_at && (
                    <span className="text-[11px] text-muted-foreground">
                      {new Date(resume.ai_analyzed_at).toLocaleString()}
                    </span>
                  )}
                </div>
                <div>
                  <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Rating
                  </p>
                  <StarRating score={resume?.ai_score ?? null} />
                </div>
                <div>
                  <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    ATS score
                  </p>
                  <p className={cn("text-2xl font-bold tabular-nums", scoreTone(resume?.ai_score ?? null))}>
                    {resume?.ai_score ?? "—"}
                    {resume?.ai_score != null && (
                      <span className="text-sm font-normal text-muted-foreground"> / 100</span>
                    )}
                  </p>
                </div>
              </div>
              {/* Details column */}
              <div className="min-w-0 space-y-3">
                {resume?.ai_status === "FAILED" && resume.ai_error ? (
                  <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    <span>{resume.ai_error}</span>
                  </div>
                ) : analysis?.summary ? (
                  <p className="text-sm text-muted-foreground">{analysis.summary}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {resume
                      ? "This resume has not been analyzed yet — run the AI review from the student's resume page."
                      : "This account has not uploaded a resume yet."}
                  </p>
                )}
                {analysis?.strengths?.length ? (
                  <div>
                    <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Strengths
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {analysis.strengths.slice(0, 8).map((item) => (
                        <span
                          key={item}
                          className="rounded-full border bg-card px-2 py-0.5 text-[11px] text-muted-foreground"
                        >
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
                {analysis?.improvements?.length ? (
                  <div>
                    <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Improvements
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {analysis.improvements.slice(0, 8).map((item) => (
                        <span
                          key={item}
                          className="rounded-full border border-amber-500/20 bg-amber-500/5 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-400"
                        >
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
                {matches.length > 0 ? (
                  <div>
                    <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Best drive matches
                    </p>
                    <div className="space-y-2">
                      {matches.map(([driveId, m]) => (
                        <div key={driveId} className="flex items-center gap-2.5">
                          <span className="w-40 truncate text-xs font-medium">
                            {m.company_name || `Drive #${driveId}`}
                          </span>
                          <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                            <div
                              className={cn("h-full rounded-full", matchBarTone(m.score))}
                              style={{ width: `${Math.min(100, Math.max(0, m.score))}%` }}
                            />
                          </div>
                          <span
                            className={cn(
                              "w-10 text-right text-xs font-semibold tabular-nums",
                              scoreTone(m.score)
                            )}
                          >
                            {Math.round(m.score)}%
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
