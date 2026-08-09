"use client";

import { RoleGuard } from "@/components/role-guard";
import { ReferenceCrud } from "@/components/reference/reference-crud";
import type { Column } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { useMetaData } from "@/lib/use-meta";
import { LoadingPage } from "@/components/loading-page";

interface SectionRow {
  id: number;
  branch: number;
  branch_name: string;
  branch_code: string;
  name: string;
  students_count: number;
}

export default function SectionsPage() {
  const { data: meta, isLoading } = useMetaData();

  const columns: Column<SectionRow>[] = [
    { key: "name", header: "Section", cell: (s) => <span className="font-medium">{s.name}</span> },
    {
      key: "branch",
      header: "Branch",
      cell: (s) => <Badge variant="secondary">{s.branch_code || s.branch_name}</Badge>,
    },
    { key: "students", header: "Students", cell: (s) => <span className="tabular-nums">{s.students_count}</span> },
  ];

  if (isLoading || !meta) return <LoadingPage />;

  return (
    <RoleGuard roles={["SUPER_ADMIN"]}>
      <ReferenceCrud
        apiPath="sections"
        title="Section Management"
        description="Sections belong to a branch (A, B, C…)."
        singular="Section"
        fields={[
          { name: "name", label: "Section Name", type: "text", placeholder: "e.g. A", required: true },
          { name: "branch", label: "Branch", type: "select", optionsSource: "branches", required: true },
        ]}
        columns={columns}
        meta={meta}
      />
    </RoleGuard>
  );
}
