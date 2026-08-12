"use client";

import { RoleGuard } from "@/components/role-guard";
import { ReferenceCrud } from "@/components/reference/reference-crud";
import type { Column } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { useMetaData } from "@/lib/use-meta";
import { LoadingPage } from "@/components/loading-page";

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

export default function CrSubjectsPage() {
  const { data: meta, isLoading } = useMetaData();
  if (isLoading || !meta) return <LoadingPage />;

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
    { key: "docs", header: "Documents", cell: (s) => <span className="tabular-nums">{s.documents_count}</span> },
  ];

  return (
    <RoleGuard roles={["CR"]}>
      <ReferenceCrud
        apiPath="subjects"
        title="Subjects"
        description="Subjects you add are shared by every section of your branch — whoever adds a subject first is the one that's used, so duplicates are rejected automatically."
        singular="Subject"
        fields={[
          { name: "name", label: "Subject Name", type: "text", placeholder: "e.g. Operating Systems", required: true },
          { name: "code", label: "Code (optional)", type: "text", placeholder: "e.g. CS303" },
          { name: "semester", label: "Semester", type: "select", optionsSource: "semesters", required: true },
        ]}
        columns={columns}
        meta={meta}
        // Pre-select the currently running semester (from the date) so it
        // doesn't have to be re-picked every time.
        defaults={{
          semester: meta.current_semester ? String(meta.current_semester.id) : "",
        }}
      />
    </RoleGuard>
  );
}
