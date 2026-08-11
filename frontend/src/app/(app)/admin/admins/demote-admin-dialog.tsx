"use client";

import { useState } from "react";
import { Loader2, ShieldOff, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { http } from "@/lib/api";
import type { User } from "@/lib/types";
import { getErrorMessage } from "@/lib/utils";

interface Props {
  target: User | null;
  onOpenChange: (open: boolean) => void;
  onDemoted?: (user: User) => void;
}

export function DemoteAdminDialog({ target, onOpenChange, onDemoted }: Props) {
  const [role, setRole] = useState("STUDENT");
  const [submitting, setSubmitting] = useState(false);

  const handleOpenChange = (next: boolean) => {
    if (next) setRole("STUDENT");
    onOpenChange(next);
  };

  const confirmDemote = async () => {
    if (!target) return;
    setSubmitting(true);
    try {
      const user = await http.post<User>(`/admins/${target.id}/demote/`, { role });
      toast.success(
        `${target.full_name} no longer has admin access. They can still log in as a ${
          role === "FACULTY" ? "faculty member" : "student"
        } with their same roll number and password.`,
        { duration: 7000 }
      );
      onOpenChange(false);
      onDemoted?.(user);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const initials = (name: string) =>
    name
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0])
      .join("")
      .toUpperCase();

  return (
    <Dialog open={!!target} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldOff className="size-5 text-destructive" />
            Remove admin access
          </DialogTitle>
          <DialogDescription>
            {target?.full_name} will immediately lose full portal control but keeps their account —
            no account is deleted.
          </DialogDescription>
        </DialogHeader>

        {target && (
          <div className="flex items-center gap-3 rounded-xl border bg-muted/40 p-3">
            <Avatar className="size-9">
              {target.avatar_url ? <AvatarImage src={target.avatar_url} alt={target.full_name} /> : null}
              <AvatarFallback className="bg-primary/10 text-xs font-bold text-primary">
                {initials(target.full_name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{target.full_name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {target.roll_number}
                {target.branch_code ? ` · ${target.branch_code}${target.section_name ? ` Sec ${target.section_name}` : ""}` : ""}
              </p>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="demote-role">Revert them to</Label>
          <Select value={role} onValueChange={(v) => setRole(v ?? "STUDENT")}>
            <SelectTrigger id="demote-role" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start" className="w-full">
              <SelectItem value="STUDENT">Student</SelectItem>
              <SelectItem value="FACULTY">Faculty</SelectItem>
            </SelectContent>
          </Select>
          {role === "FACULTY" && !target?.branch && (
            <p className="text-xs text-muted-foreground">
              They have no branch assigned — you can assign one later in Admin → Faculty.
            </p>
          )}
        </div>

        <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <p>
            This is not reversible from their side. They will still log in with the same roll
            number and password, just without admin powers.
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={confirmDemote} disabled={!target || submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Remove Admin Access
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
