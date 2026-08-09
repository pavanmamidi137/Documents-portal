"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ListPlus } from "lucide-react";

import { RoleGuard } from "@/components/role-guard";
import { ReferenceCrud } from "@/components/reference/reference-crud";
import type { Column } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useMetaData } from "@/lib/use-meta";
import { LoadingPage } from "@/components/loading-page";
import { BulkSubjectImportDialog } from "./bulk-subject-import-dialog";

interface SubjectRow {
  id: number;
  name: string;
  code: string;
  semester: number;
  semester_name: string;
  branch: number | null;
  branch_name: string | null;
  branch_code: string;
  documents_count: number;
}

export default function SubjectsPage() {
  const { data: meta, isLoading } = useMetaData();
  const queryClient = useQueryClient();
  const [bulkOpen, setBulkOpen] = useState(false);

  const columns: Column<SubjectRow>[] = [
    { key: "name", header: "Subject", cell: (s) => <span className="font-medium">{s.name}</span> },
    {
      key: "code",
      header: "Code",
      cell: (s) => (s.code ? <Badge variant="outline">{s.code}</Badge> : "—"),
    },
    {
      key: "semester",
      header: "Semester",
      cell: (s) => <Badge variant="secondary">{s.semester_name}</Badge>,
    },
    {
      key: "branch",
      header: "Branch",
      cell: (s) => (s.branch_name ? <Badge variant="outline">{s.branch_code || s.branch_name}</Badge> : <span className="text-muted-foreground">All branches</span>),
    },
    { key: "docs", header: "Documents", cell: (s) => <span className="tabular-nums">{s.documents_count}</span> },
  ];

  if (isLoading || !meta) return <LoadingPage />;

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ["subjects"] });
    queryClient.invalidateQueries({ queryKey: ["meta"] });
  };

  return (
    <RoleGuard roles={["SUPER_ADMIN"]}>
      <ReferenceCrud
        apiPath="subjects"
        title="Subject Management"
        description="Subjects are linked to a semester; leave branch empty for college-wide subjects."
        singular="Subject"
        extraActions={
          <Button variant="outline" onClick={() => setBulkOpen(true)} className="gap-2">
            <ListPlus className="size-4" /> Bulk Import
          </Button>
        }
        fields={[
          { name: "name", label: "Subject Name", type: "text", placeholder: "e.g. Operating Systems", required: true },
          { name: "code", label: "Code (optional)", type: "text", placeholder: "e.g. CS303" },
          { name: "semester", label: "Semester", type: "select", optionsSource: "semesters", required: true },
          { name: "branch", label: "Branch (optional)", type: "select", optionsSource: "branches" },
        ]}
        columns={columns}
        meta={meta}
      />

      {/* key remounts the dialog on open so its form state starts fresh. */}
      <BulkSubjectImportDialog
        key={String(bulkOpen)}
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        meta={meta}
        onImported={refreshAll}
      />
    </RoleGuard>
  );
}
