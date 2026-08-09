"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  BrainCircuit,
  CheckCircle2,
  CircleOff,
  KeyRound,
  Pencil,
  PlugZap,
  Plus,
  Power,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

import { AiKeysDialog } from "@/components/admin/ai-keys-dialog";
import { AiProviderFormDialog } from "@/components/admin/ai-provider-form-dialog";
import { AiTaskFormDialog } from "@/components/admin/ai-task-form-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { RoleGuard } from "@/components/role-guard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { http } from "@/lib/api";
import type {
  AiHealthReport,
  AiHealthStatus,
  AiProvider,
  AiProviderHealth,
  AiRequestLogRow,
  AiSettings,
  AiTaskConfig,
  AiUsageStats,
  Paginated,
} from "@/lib/types";
import { cn, getErrorMessage } from "@/lib/utils";

type Tab = "providers" | "tasks" | "settings" | "usage";

function healthBadge(status: AiHealthStatus) {
  const map: Record<AiHealthStatus, { label: string; cls: string }> = {
    HEALTHY: { label: "Healthy", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
    DEGRADED: { label: "Degraded", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
    RATE_LIMITED: { label: "Rate Limited", cls: "bg-orange-500/15 text-orange-600 dark:text-orange-400" },
    UNAVAILABLE: { label: "Unavailable", cls: "bg-red-500/15 text-red-600 dark:text-red-400" },
    DISABLED: { label: "Disabled", cls: "bg-muted text-muted-foreground" },
    UNKNOWN: { label: "Unknown", cls: "bg-muted text-muted-foreground" },
  };
  const m = map[status] ?? map.UNKNOWN;
  return <Badge variant="outline" className={cn("font-medium", m.cls)}>{m.label}</Badge>;
}

export default function AiManagementPage() {
  const [tab, setTab] = useState<Tab>("providers");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AiProvider | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AiProvider | null>(null);
  const [providerSearch, setProviderSearch] = useState("");
  const [taskEditor, setTaskEditor] = useState<AiTaskConfig | null>(null);
  const [keysFor, setKeysFor] = useState<AiProvider | null>(null);
  const queryClient = useQueryClient();

  const providersQuery = useQuery({
    queryKey: ["ai-providers"],
    queryFn: () => http.get<Paginated<AiProvider>>("/admin/ai/providers/"),
  });
  const healthQuery = useQuery({
    queryKey: ["ai-health"],
    queryFn: () => http.get<AiProviderHealth[]>("/admin/ai/health/"),
  });
  const tasksQuery = useQuery({
    queryKey: ["ai-tasks"],
    queryFn: () => http.get<AiTaskConfig[]>("/admin/ai/tasks/"),
  });
  const settingsQuery = useQuery({
    queryKey: ["ai-settings"],
    queryFn: () => http.get<AiSettings>("/admin/ai/settings/"),
  });
  const usageQuery = useQuery({
    queryKey: ["ai-usage-stats"],
    queryFn: () => http.get<AiUsageStats>("/admin/ai/usage/"),
  });
  const reportQuery = useQuery({
    queryKey: ["ai-usage-report"],
    queryFn: () => http.get<AiHealthReport>("/admin/ai/usage/report/"),
  });
  const [sendingReport, setSendingReport] = useState(false);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["ai-providers"] });
    queryClient.invalidateQueries({ queryKey: ["ai-health"] });
    queryClient.invalidateQueries({ queryKey: ["ai-tasks"] });
    queryClient.invalidateQueries({ queryKey: ["ai-usage-stats"] });
  };

  const healthByProvider = useMemo(() => {
    const map = new Map<number, AiProviderHealth>();
    for (const h of healthQuery.data ?? []) map.set(h.provider, h);
    return map;
  }, [healthQuery.data]);

  const providers = useMemo(() => providersQuery.data?.results ?? [], [providersQuery.data]);

  const filteredProviders = useMemo(() => {
    const q = providerSearch.trim().toLowerCase();
    const list = q
      ? providers.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.model.toLowerCase().includes(q) ||
            p.provider_type_label.toLowerCase().includes(q)
        )
      : providers;
    return [...list].sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  }, [providers, providerSearch]);

  const setSettingsNumber = async (key: "default_timeout_seconds" | "default_max_retries", value: number) => {
    try {
      await http.patch("/admin/ai/settings/", { [key]: value });
      toast.success("AI settings saved");
      queryClient.invalidateQueries({ queryKey: ["ai-settings"] });
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const toggleProvider = async (provider: AiProvider) => {
    try {
      await http.patch(`/admin/ai/providers/${provider.id}/`, { enabled: !provider.enabled });
      toast.success(provider.enabled ? "Provider disabled" : "Provider enabled");
      refresh();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const testProvider = async (provider: AiProvider) => {
    try {
      const data = await http.post<{ ok: boolean; detail: string }>(
        `/admin/ai/providers/${provider.id}/test/`
      );
      if (data.ok) toast.success(`${provider.name}: connection successful`);
      else toast.error(`${provider.name}: ${data.detail}`);
      refresh();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await http.delete(`/admin/ai/providers/${pendingDelete.id}/`);
      toast.success("Provider deleted");
      refresh();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setPendingDelete(null);
    }
  };

  const saveSettings = async (patch: Partial<AiSettings>) => {
    try {
      await http.patch("/admin/ai/settings/", patch);
      toast.success("AI settings saved");
      queryClient.invalidateQueries({ queryKey: ["ai-settings"] });
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const loading = providersQuery.isLoading && !providersQuery.data;

  const sendReportNow = async () => {
    setSendingReport(true);
    try {
      const data = await http.post<{ detail: string }>("/admin/ai/usage/send_report/");
      toast.success(data.detail);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSendingReport(false);
    }
  };

  return (
    <RoleGuard roles={["SUPER_ADMIN"]}>
      <div className="space-y-6">
        <PageHeader
          title="AI Management"
          description="Configure AI providers, task routing, caching and health from here."
          actions={
            <div className="flex gap-2">
              <Button variant="outline" onClick={refresh}>
                <RefreshCw className="mr-2 h-4 w-4" /> Refresh
              </Button>
              <Button
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
                <Plus className="mr-2 h-4 w-4" /> Add Provider
              </Button>
            </div>
          }
        />

        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList className="grid w-full grid-cols-4 sm:w-auto">
            <TabsTrigger value="providers">Providers</TabsTrigger>
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
            <TabsTrigger value="usage">Usage</TabsTrigger>
          </TabsList>

          {/* ---------------- Providers ---------------- */}
          {tab === "providers" && (
            <Card className="mt-4">
              <CardContent className="p-0">
                {providers.length > 0 && (
                  <div className="flex items-center gap-2 border-b p-3">
                    <Input
                      placeholder="Search providers..."
                      value={providerSearch}
                      onChange={(e) => setProviderSearch(e.target.value)}
                      className="max-w-xs"
                    />
                    <span className="text-xs text-muted-foreground">
                      {filteredProviders.length} of {providers.length} providers
                    </span>
                  </div>
                )}
                {loading ? (
                  <div className="space-y-3 p-6">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ) : filteredProviders.length === 0 ? (
                  <EmptyState
                    icon={BrainCircuit}
                    title="No AI providers yet"
                    description="Add your first provider (Gemini, NVIDIA, Groq...) to start routing AI requests."
                  />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Provider</TableHead>
                        <TableHead>Model</TableHead>
                        <TableHead>Priority</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Health</TableHead>
                        <TableHead>Last used</TableHead>
                        <TableHead>Keys</TableHead>
                        <TableHead>Errors</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredProviders.map((p) => {
                        const health = healthByProvider.get(p.id);
                        return (
                          <TableRow key={p.id}>
                            <TableCell>
                              <p className="font-medium">{p.name}</p>
                              <p className="text-xs text-muted-foreground">{p.provider_type_label}</p>
                            </TableCell>
                            <TableCell className="font-mono text-xs">{p.model}</TableCell>
                            <TableCell>{p.priority}</TableCell>
                            <TableCell>
                              {p.enabled ? (
                                <Badge variant="outline" className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">Active</Badge>
                              ) : (
                                <Badge variant="outline" className="bg-muted text-muted-foreground">Disabled</Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              {healthBadge(health?.status ?? p.health)}
                              {health?.last_error_type && (
                                <p className="mt-0.5 max-w-[140px] truncate text-[11px] text-muted-foreground">
                                  {health.last_error_type}
                                </p>
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {health?.last_used_at
                                ? new Date(health.last_used_at).toLocaleDateString()
                                : "—"}
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs font-normal"
                                onClick={() => setKeysFor(p)}
                                title="Manage extra API keys"
                              >
                                <KeyRound className="mr-1 h-3.5 w-3.5" />
                                {p.extra_keys.length > 0 ? `${p.extra_keys.length} keys` : "Keys"}
                              </Button>
                            </TableCell>
                            <TableCell>{p.total_errors}</TableCell>
                            <TableCell>
                              <div className="flex items-center justify-end gap-1">
                                <Button variant="ghost" size="icon" title="Toggle enabled" onClick={() => toggleProvider(p)}>
                                  <Power className="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="icon" title="Test connection" onClick={() => testProvider(p)}>
                                  <PlugZap className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  title="Edit"
                                  onClick={() => {
                                    setEditing(p);
                                    setFormOpen(true);
                                  }}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  title="Delete"
                                  className="text-destructive"
                                  onClick={() => setPendingDelete(p)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          )}

          {/* ---------------- Tasks ---------------- */}
          {tab === "tasks" && (
            <Card className="mt-4">
              <CardHeader>
                <CardTitle className="text-base">Task routing</CardTitle>
                <CardDescription>
                  Which provider (and fallback chain) serves each AI task. Empty = any enabled provider by priority.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Task</TableHead>
                      <TableHead>Primary</TableHead>
                      <TableHead>Fallback 1</TableHead>
                      <TableHead>Fallback 2</TableHead>
                      <TableHead>Fallback 3</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(tasksQuery.data ?? []).map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="font-medium">{t.task_label}</TableCell>
                        <TableCell>{t.primary_name || <span className="text-muted-foreground">Any</span>}</TableCell>
                        <TableCell>{t.fallback_1_name || <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell>{t.fallback_2_name || <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell>{t.fallback_3_name || <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Edit task routing"
                            onClick={() => setTaskEditor(t)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {providers.length === 0 && (
                  <p className="border-t px-4 py-3 text-sm text-muted-foreground">
                    Add providers first - task routing will then be configurable.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* ---------------- Settings ---------------- */}
          {tab === "settings" && (
            <div className="mt-4 grid gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Defaults</CardTitle>
                  <CardDescription>Applied to newly added providers.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="ai-default-timeout">Default timeout (seconds)</Label>
                    <Input
                      id="ai-default-timeout"
                      type="number"
                      defaultValue={settingsQuery.data?.default_timeout_seconds ?? 60}
                      onBlur={(e) =>
                        setSettingsNumber("default_timeout_seconds", Number(e.target.value) || 60)
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ai-default-retries">Default max retries</Label>
                    <Input
                      id="ai-default-retries"
                      type="number"
                      defaultValue={settingsQuery.data?.default_max_retries ?? 2}
                      onBlur={(e) =>
                        setSettingsNumber("default_max_retries", Number(e.target.value) || 0)
                      }
                    />
                  </div>
                </CardContent>
              </Card>
              <SettingsToggleCard
                title="AI service"
                description="Master switch for every AI feature in the portal."
                checked={settingsQuery.data?.enable_ai ?? true}
                onChange={(v) => saveSettings({ enable_ai: v })}
              />
              <SettingsToggleCard
                title="Provider failover"
                description="Automatically try the next provider when the primary fails."
                checked={settingsQuery.data?.enable_fallback ?? true}
                onChange={(v) => saveSettings({ enable_fallback: v })}
              />
              <SettingsToggleCard
                title="Response caching"
                description="Repeated questions are answered from cache - no extra AI cost."
                checked={settingsQuery.data?.enable_caching ?? true}
                onChange={(v) => saveSettings({ enable_caching: v })}
              />
              <SettingsToggleCard
                title="Web research"
                description="Allow the AI to consult current web information when needed."
                checked={settingsQuery.data?.enable_web_research ?? true}
                onChange={(v) => saveSettings({ enable_web_research: v })}
              />
              <SettingsToggleCard
                title="Maintenance mode"
                description="Temporarily pause all AI calls with a friendly message."
                checked={settingsQuery.data?.maintenance_mode ?? false}
                onChange={(v) => saveSettings({ maintenance_mode: v })}
              />
            </div>
          )}

          {/* ---------------- Usage ---------------- */}
          {tab === "usage" && (
            <div className="mt-4 space-y-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">Daily health report</CardTitle>
                    <CardDescription>
                      Provider uptime, errors and estimated cost over the last 24h. A daily
                      summary is also delivered as an in-app notification.
                    </CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={sendReportNow} disabled={sendingReport}>
                    <Bell className="mr-2 h-4 w-4" />
                    {sendingReport ? "Sending..." : "Send report now"}
                  </Button>
                </CardHeader>
                <CardContent>
                  {reportQuery.isLoading ? (
                    <div className="space-y-2">
                      <Skeleton className="h-6 w-1/3" />
                      <Skeleton className="h-20 w-full" />
                    </div>
                  ) : reportQuery.data?.empty ? (
                    <p className="text-sm text-muted-foreground">
                      No AI activity in the last 24h - the daily report is skipped until there is.
                    </p>
                  ) : (
                    <DailyHealthReport report={reportQuery.data} />
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Request log</CardTitle>
                  <CardDescription>
                    Every AI call routed through the provider manager (no prompts or keys stored).
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
                  <Stat label="Total calls" value={usageQuery.data?.totals.calls ?? 0} />
                  <Stat label="Success" value={usageQuery.data?.totals.success ?? 0} good />
                  <Stat label="Errors" value={usageQuery.data?.totals.errors ?? 0} bad />
                  <Stat label="Fallbacks" value={usageQuery.data?.totals.fallback_used ?? 0} />
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Task</TableHead>
                      <TableHead>Provider</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Tokens</TableHead>
                      <TableHead>Latency</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(usageQuery.data?.recent ?? []).map((log: AiRequestLogRow) => (
                      <TableRow key={log.id}>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(log.created_at).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-xs">{log.task}</TableCell>
                        <TableCell className="text-xs">
                          {log.provider_used}
                          {log.fallback_used && (
                            <Badge variant="outline" className="ml-1.5 bg-amber-500/15 text-amber-600">fallback</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">{log.user_name}</TableCell>
                        <TableCell>
                          {log.status === "SUCCESS" ? (
                            <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                              <CheckCircle2 className="h-3.5 w-3.5" /> Success
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
                              <CircleOff className="h-3.5 w-3.5" /> {log.error_type || "Failed"}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">{log.prompt_tokens + log.completion_tokens}</TableCell>
                        <TableCell className="text-xs">{log.latency_ms}ms</TableCell>
                      </TableRow>
                    ))}
                    {!loading && (usageQuery.data?.recent ?? []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                          No AI requests yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            </div>
          )}
        </Tabs>
      </div>

      <AiProviderFormDialog
        key={editing ? `edit-${editing.id}` : formOpen ? "new" : "closed"}
        open={formOpen}
        onOpenChange={setFormOpen}
        provider={editing}
        onSaved={refresh}
      />

      <AiTaskFormDialog
        key={taskEditor ? `task-${taskEditor.id}` : "closed"}
        open={Boolean(taskEditor)}
        onOpenChange={(o) => !o && setTaskEditor(null)}
        task={taskEditor}
        providers={providers}
        onSaved={refresh}
      />

      <AiKeysDialog
        key={keysFor ? `keys-${keysFor.id}` : "closed"}
        open={Boolean(keysFor)}
        onOpenChange={(o) => !o && setKeysFor(null)}
        provider={keysFor}
        onSaved={refresh}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title={`Delete ${pendingDelete?.name ?? ""}?`}
        description="The provider will be removed from the router. Requests will fail over to the next available provider."
        confirmLabel="Delete provider"
        destructive
        onConfirm={confirmDelete}
      />
    </RoleGuard>
  );
}

function DailyHealthReport({ report }: { report: AiHealthReport | undefined }) {
  if (!report) return null;
  const t = report.totals;
  const providerRows = Object.entries(report.providers ?? {});
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Calls (24h)" value={t.calls} />
        <Stat label="Success" value={t.success} good />
        <Stat label="Errors" value={t.errors} bad />
        <Stat label="Est. cost" value={`$${t.estimated_cost.toFixed(2)}`} />
      </div>
      {providerRows.length > 0 && (
        <div className="overflow-hidden rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Provider</th>
                <th className="px-3 py-2 font-medium">Calls</th>
                <th className="px-3 py-2 font-medium">Errors</th>
                <th className="px-3 py-2 font-medium">Uptime</th>
                <th className="px-3 py-2 text-right font-medium">Est. cost</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {providerRows.map(([name, p]) => (
                <tr key={name}>
                  <td className="px-3 py-2 font-medium">{name}</td>
                  <td className="px-3 py-2">{p.calls}</td>
                  <td className="px-3 py-2">{p.errors}</td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "font-medium",
                        p.uptime_pct >= 99 ? "text-emerald-600 dark:text-emerald-400" :
                        p.uptime_pct >= 90 ? "text-amber-600 dark:text-amber-400" :
                        "text-red-600 dark:text-red-400"
                      )}
                    >
                      {p.uptime_pct}%
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">${p.estimated_cost.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(report.top_error_types ?? []).length > 0 && (
        <p className="text-xs text-muted-foreground">
          Top errors:{" "}
          {report.top_error_types.map((e) => `${e.type} × ${e.count}`).join(", ")}
        </p>
      )}
      <p className="text-[11px] text-muted-foreground">
        Providers with no activity are omitted · cost is a flat per-million-token estimate
        (configurable via the <code className="font-mono">ai_cost_per_million_tokens</code> setting).
      </p>
    </div>
  );
}

function Stat({ label, value, good, bad }: { label: string; value: number | string; good?: boolean; bad?: boolean }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-2xl font-semibold",
          good && "text-emerald-600 dark:text-emerald-400",
          bad && "text-red-600 dark:text-red-400"
        )}
      >
        {value}
      </p>
    </div>
  );
}

function SettingsToggleCard({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-4 py-4">
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <Switch checked={checked} onCheckedChange={onChange} />
      </CardContent>
    </Card>
  );
}
