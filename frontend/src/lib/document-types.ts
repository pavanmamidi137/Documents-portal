import {
  File,
  FileSpreadsheet,
  FileText,
  FileType,
  Presentation,
  type LucideIcon,
} from "lucide-react";

/** File extensions accepted by the document upload (mirrors the backend). */
export const ALLOWED_UPLOAD_EXTENSIONS = ["pdf", "ppt", "pptx", "doc", "docx", "txt"] as const;

export const MAX_DOCUMENT_SIZE_MB = 20;

/** Unit choices shown in the upload dialog; the chosen unit fills the title. */
export const UPLOAD_UNITS = ["Unit 1", "Unit 2", "Unit 3", "Unit 4", "Unit 5"] as const;

export function getDocumentExt(fileName: string): string {
  const match = /\.([a-zA-Z0-9]+)$/.exec(fileName ?? "");
  return match ? match[1].toLowerCase() : "";
}

export function isAllowedDocument(fileName: string): boolean {
  return (ALLOWED_UPLOAD_EXTENSIONS as readonly string[]).includes(getDocumentExt(fileName));
}

export interface DocumentTypeMeta {
  Icon: LucideIcon;
  label: string;
  classes: string; // icon wrapper styling (bg / text / ring)
}

/** Visual metadata for a document, derived from its file extension. */
export function getDocumentTypeMeta(fileName: string): DocumentTypeMeta {
  switch (getDocumentExt(fileName)) {
    case "ppt":
    case "pptx":
      return {
        Icon: Presentation,
        label: "Presentation",
        classes: "bg-orange-500/10 text-orange-500 ring-orange-500/20",
      };
    case "doc":
    case "docx":
      return {
        Icon: FileText,
        label: "Word Document",
        classes: "bg-sky-500/10 text-sky-500 ring-sky-500/20",
      };
    case "txt":
      return {
        Icon: FileType,
        label: "Text File",
        classes: "bg-slate-500/10 text-slate-500 ring-slate-500/20",
      };
    case "pdf":
      return {
        Icon: FileText,
        label: "PDF",
        classes: "bg-rose-500/10 text-rose-500 ring-rose-500/20",
      };
    case "csv":
    case "xlsx":
    case "xls":
      return {
        Icon: FileSpreadsheet,
        label: "Spreadsheet",
        classes: "bg-emerald-500/10 text-emerald-500 ring-emerald-500/20",
      };
    default:
      return {
        Icon: File,
        label: "File",
        classes: "bg-muted text-muted-foreground ring-border",
      };
  }
}
