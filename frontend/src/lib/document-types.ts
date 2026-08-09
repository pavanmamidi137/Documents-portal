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
// Files larger than this are rejected up front; anything below is compressed
// server-side (PDF/PPTX/DOCX) to fit under MAX_DOCUMENT_SIZE_MB.
export const MAX_DOCUMENT_INPUT_MB = 40;

/** Unit choices shown in the upload dialog; the chosen unit fills the title. */
export const UPLOAD_UNITS = ["Unit 1", "Unit 2", "Unit 3", "Unit 4", "Unit 5"] as const;

/**
 * Extracts the unit label from a document title (e.g. "DBMS - Unit 1" →
 * "Unit 1", "UNIT-2 notes" → "Unit 2", "Unit III" → "Unit III").
 * Documents without a unit in the title fall into "General".
 */
export function getUnitLabel(title: string): string {
  const match = /\bunit\s*[-–:.]?\s*([0-9]+|[ivxlcdm]+)\b/i.exec(title ?? "");
  if (!match) return "General";
  const raw = match[1];
  return /^\d+$/.test(raw) ? `Unit ${raw}` : `Unit ${raw.toUpperCase()}`;
}

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
