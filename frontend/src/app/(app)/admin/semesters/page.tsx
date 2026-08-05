"use client";

import { RoleGuard } from "@/components/role-guard";
import { ReferenceCrud } from "@/components/reference/reference-crud";
import type { Column } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";

interface SemesterRow {
  id: number;
  name: string;
  order: number;
  subjects_count: number;
  documents_count: number;
}

const columns: Column<SemesterRow>[] = [
  {
    key: "name",
    header: "Semester",
    cell: (s) => (
      <span className="font-medium">
        Semester <Badge variant="outline">{s.name}</Badge>
      </span>
    ),
  },
  { key: "subjects", header: "Subjects", cell: (s) => <span className="tabular-nums">{s.subjects_count}</span> },
  { key: "docs", header: "Documents", cell: (s) => <span className="tabular-nums">{s.documents_count}</span> },
];

export default function SemestersPage() {
  return (
    <RoleGuard roles={["SUPER_ADMIN"]}>
      <ReferenceCrud
        apiPath="semesters"
        title="Semester Management"
        description="Academic semesters such as 1-1, 1-2, 2-1…"
        singular="Semester"
        fields={[
          { name: "name", label: "Semester Name", type: "text", placeholder: "e.g. 3-1", required: true },
          { name: "order", label: "Sort Order", type: "number", placeholder: "e.g. 5" },
        ]}
        columns={columns}
      />
    </RoleGuard>
  );
}
