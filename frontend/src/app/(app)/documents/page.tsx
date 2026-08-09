"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useMetaData } from "@/lib/use-meta";
import { DocumentsManagement } from "@/components/documents/documents-management";
import { StudentBrowser } from "@/components/documents/student-browser";
import { LoadingPage } from "@/components/loading-page";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FolderKanban, ListChecks } from "lucide-react";

export default function DocumentsPage() {
  const { user } = useAuth();
  const { data: meta, isLoading } = useMetaData();
  const isStudent = user?.is_student ?? false;
  const isCr = user?.is_cr ?? false;
  const [tab, setTab] = useState("browse");

  if (isLoading || !meta) return <LoadingPage />;

  // Students browse only. CRs and admins get Browse + Manage tabs.
  if (isStudent) return <StudentBrowser />;

  return (
    <Tabs value={tab} onValueChange={setTab} className="space-y-5">
      <TabsList>
        <TabsTrigger value="browse" className="gap-1.5">
          <FolderKanban className="size-4" /> Browse
        </TabsTrigger>
        <TabsTrigger value="manage" className="gap-1.5">
          <ListChecks className="size-4" /> {isCr ? "My Section" : "Manage"}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="browse" className="mt-0">
        <StudentBrowser />
      </TabsContent>
      <TabsContent value="manage" className="mt-0">
        <DocumentsManagement meta={meta} isCr={isCr} />
      </TabsContent>
    </Tabs>
  );
}
