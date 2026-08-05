"use client";

import { RoleGuard } from "@/components/role-guard";
import { ReferenceCrud } from "@/components/reference/reference-crud";
import type { Column } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";

interface BranchRow {
  id: number;
  name: string;
  code: string;
  sections_count: number;
  students_count: number;
}

const columns: Column<BranchRow>[] = [
  { key: "name", header: "Branch", cell: (b) => <span className="font-medium">{b.name}</span> },
  {
    key: "code",
    header: "Code",
    cell: (b) => (b.code ? <Badge variant="outline">{b.code}</Badge> : "—"),
  },
  { key: "sections", header: "Sections", cell: (b) => <span className="tabular-nums">{b.sections_count}</span> },
  { key: "students", header: "Students", cell: (b) => <span className="tabular-nums">{b.students_count}</span> },
];

export default function BranchesPage() {
  return (
    <RoleGuard roles={["SUPER_ADMIN"]}>
      <ReferenceCrud
        apiPath="branches"
        title="Branch Management"
        description="Create and manage academic branches (CSE, ECE, IT…)."
        singular="Branch"
        fields={[
          { name: "name", label: "Branch Name", type: "text", placeholder: "e.g. Computer Science", required: true },
          { name: "code", label: "Code (optional)", type: "text", placeholder: "e.g. CSE" },
        ]}
        columns={columns}
      />
    </RoleGuard>
  );
}
