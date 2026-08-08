"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BrainCircuit, Coins, Loader2, Save } from "lucide-react";
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
import type { AiUsageData } from "@/lib/types";
import { cn, getErrorMessage } from "@/lib/utils";

export default function AiUsagePage() {
  const queryClient = useQueryClient();
  const [budgetInput, setBudgetInput] = useState("");
  const [saving, setSaving] = useState(false);

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
              <div className="border-b px-5 py-4">
                <h3 className="font-semibold">Usage by Student</h3>
                <p className="text-xs text-muted-foreground">
                  How many AI credits each account has consumed so far.
                </p>
              </div>
              {!data?.per_user || data.per_user.length === 0 ? (
                <div className="py-8">
                  <EmptyState
                    icon={BrainCircuit}
                    title="No AI usage yet"
                    description="Token usage will appear here once students and staff start using the AI features."
                  />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
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
                      {data.per_user.map((u, i) => (
                        <TableRow key={u.user_id}>
                          <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                          <TableCell>
                            <span className="font-medium">{u.name}</span>
                            <span className="block font-mono text-xs text-muted-foreground">
                              {u.roll_number}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{u.role || "—"}</Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{u.calls}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {u.prompt_tokens.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {u.completion_tokens.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">
                            {u.total_tokens.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {Math.ceil(u.total_tokens / 1000).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {totalAcrossUsers > 0
                              ? `${Math.round((u.total_tokens / totalAcrossUsers) * 100)}%`
                              : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
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
