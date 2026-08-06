"use client";

import { useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, Download, FileSpreadsheet, Loader2, UploadCloud, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import type { ImportResult, MetaData } from "@/lib/types";
import { getErrorMessage } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
  meta: MetaData;
  isCr?: boolean;
}

const SAMPLE_CSV = [
  "Roll Number,Student Name,Phone,Email",
  "21CSE01,Aarav Sharma,9876543210,aarav@example.com",
  "21CSE02,Bhavya Reddy,9876543211,bhavya@example.com",
].join("\n");

function downloadSample() {
  const blob = new Blob([SAMPLE_CSV], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "students-import-template.csv";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function CsvImportDialog({ open, onOpenChange, onImported, meta, isCr = false }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [branch, setBranch] = useState("");
  const [section, setSection] = useState("");

  const reset = () => {
    setFile(null);
    setResult(null);
    setBranch("");
    setSection("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const sections = useMemo(
    () => meta.sections.filter((s) => !branch || s.branch === Number(branch)),
    [meta.sections, branch]
  );

  const ready = Boolean(file) && (isCr || Boolean(branch && section));

  const handleFile = (f: File | null) => {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".csv")) {
      toast.error("Only .csv files are supported.");
      return;
    }
    setFile(f);
    setResult(null);
  };

  const handleImport = async () => {
    if (!file || !ready) return;
    setLoading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      if (!isCr) {
        form.append("branch", branch);
        form.append("section", section);
      }
      // Large files take a while to import on the server - give the request
      // room so it doesn't time out while hundreds of students are saved.
      const res = await http.upload<ImportResult>("/students/import_csv/", form, 300_000);
      setResult(res);
      toast.success(`Import complete: ${res.created} created, ${res.updated} updated.`);
      onImported();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="size-5 text-primary" /> Bulk Import Students
          </DialogTitle>
          <DialogDescription>
            {isCr
              ? "Your CSV needs these columns: Roll Number, Student Name, Phone, Email (optional). Roll numbers are saved in capitals and the default password is the Roll Number. Every student is added to your assigned section."
              : "Your CSV needs these columns: Roll Number, Student Name, Phone, Email (optional). Roll numbers are saved in capitals and the default password is the Roll Number. Choose the branch and section below — every row is added there."}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            className="space-y-3"
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2 rounded-xl border bg-emerald-500/5 p-3">
                <CheckCircle2 className="size-5 text-emerald-500" />
                <div>
                  <p className="text-lg font-bold">{result.created}</p>
                  <p className="text-xs text-muted-foreground">Created</p>
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-xl border bg-sky-500/5 p-3">
                <UploadCloud className="size-5 text-sky-500" />
                <div>
                  <p className="text-lg font-bold">{result.updated}</p>
                  <p className="text-xs text-muted-foreground">Updated</p>
                </div>
              </div>
            </div>
            {result.skipped_errors.length > 0 && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
                <p className="mb-1 flex items-center gap-1.5 font-medium text-destructive">
                  <XCircle className="size-4" /> {result.skipped_errors.length} row(s) skipped
                </p>
                <ul className="max-h-28 space-y-0.5 overflow-y-auto text-xs text-muted-foreground">
                  {result.skipped_errors.slice(0, 10).map((e, i) => (
                    <li key={i}>
                      Row {e.row}: {e.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Button className="w-full" onClick={reset}>
              Import another file
            </Button>
          </motion.div>
        ) : (
          <div className="space-y-4">
            {!isCr && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Branch</Label>
                  <Select
                    value={branch}
                    onValueChange={(v) => {
                      setBranch(v ?? "");
                      setSection("");
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select branch" />
                    </SelectTrigger>
                    <SelectContent>
                      {meta.branches.map((b) => (
                        <SelectItem key={b.id} value={String(b.id)}>
                          {b.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Section</Label>
                  <Select value={section} onValueChange={(v) => setSection(v ?? "")} disabled={!branch}>
                    <SelectTrigger>
                      <SelectValue placeholder={branch ? "Select section" : "Pick a branch first"} />
                    </SelectTrigger>
                    <SelectContent>
                      {sections.map((s) => (
                        <SelectItem key={s.id} value={String(s.id)}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                handleFile(e.dataTransfer.files?.[0] ?? null);
              }}
              className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
                dragOver ? "border-primary bg-primary/5" : "hover:border-primary/50 hover:bg-muted/40"
              }`}
            >
              <FileSpreadsheet className="size-8 text-muted-foreground" />
              {file ? (
                <p className="text-sm font-medium text-foreground">{file.name}</p>
              ) : (
                <>
                  <p className="text-sm font-medium">Drop your CSV here or click to browse</p>
                  <p className="text-xs text-muted-foreground">Headers are matched case-insensitively</p>
                </>
              )}
              <input
                ref={inputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
              />
            </label>

            <div className="flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              <span className="font-mono">Roll Number, Student Name, Phone, Email</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={downloadSample}
              >
                <Download className="size-3.5" /> Sample CSV
              </Button>
            </div>

            <Button className="w-full" disabled={!ready || loading} onClick={handleImport}>
              {loading && <Loader2 className="size-4 animate-spin" />}
              {loading ? "Importing…" : "Start Import"}
            </Button>
            {loading && (
              <p className="text-center text-xs text-muted-foreground">
                Please wait — large files can take a minute or two. Don&apos;t close this window.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
