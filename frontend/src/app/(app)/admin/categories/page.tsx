"use client";

import { RoleGuard } from "@/components/role-guard";
import { ReferenceCrud } from "@/components/reference/reference-crud";
import type { Column } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";

interface CategoryRow {
  id: number;
  name: string;
  icon: string;
  documents_count: number;
}

const columns: Column<CategoryRow>[] = [
  { key: "name", header: "Category", cell: (c) => <span className="font-medium">{c.name}</span> },
  {
    key: "icon",
    header: "Icon",
    cell: (c) => (c.icon ? <Badge variant="outline">{c.icon}</Badge> : "—"),
  },
  { key: "docs", header: "Documents", cell: (c) => <span className="tabular-nums">{c.documents_count}</span> },
];

export default function CategoriesPage() {
  return (
    <RoleGuard roles={["SUPER_ADMIN"]}>
      <ReferenceCrud
        apiPath="categories"
        title="Category Management"
        description="Document categories such as Mid-1, Notes, Lab Manuals…"
        singular="Category"
        fields={[
          { name: "name", label: "Category Name", type: "text", placeholder: "e.g. Question Bank", required: true },
          { name: "icon", label: "Icon (optional)", type: "text", placeholder: "e.g. file-text" },
        ]}
        columns={columns}
      />
    </RoleGuard>
  );
}
