"use client";

import { toast } from "sonner";

import { http } from "@/lib/api";
import { formatBytes, getErrorMessage } from "@/lib/utils";

/**
 * Download a document through the signed Cloudinary URL, streaming the bytes
 * in the browser so the user sees a live progress toast: how much has been
 * downloaded ("42% · 2.3 MB of 5.4 MB") and a "complete" confirmation.
 *
 * The POST first asks the API for the signed URL (bumps the download counter),
 * then the file is fetched as a stream and saved as a blob - no popups, no
 * tab-switching. Returns true when the file was saved.
 */
export async function downloadDocument(doc: {
  id: number;
  title: string;
  file_name: string;
}): Promise<boolean> {
  const toastId = toast.loading(`Preparing ${doc.file_name}…`);
  try {
    const res = await http.post<{ download_url: string }>(`/documents/${doc.id}/download/`);
    const response = await fetch(res.download_url);
    if (!response.ok) throw new Error(`Download failed (${response.status}).`);
    if (!response.body) throw new Error("Download failed - no data received.");

    const total = Number(response.headers.get("Content-Length")) || 0;
    const reader = response.body.getReader();
    const chunks: BlobPart[] = [];
    let received = 0;
    let lastToastAt = 0;

    const report = (done = false) => {
      const now = Date.now();
      if (!done && now - lastToastAt < 120) return; // throttle toast updates
      lastToastAt = now;
      const label =
        total > 0
          ? `${Math.min(99, Math.round((received / total) * 100))}% · ${formatBytes(received)} of ${formatBytes(total)}`
          : `${formatBytes(received)} downloaded`;
      toast.loading(done ? `Saving ${doc.file_name}…` : `Downloading ${doc.file_name} — ${label}`, {
        id: toastId,
      });
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      report();
    }
    report(true);

    const blob = new Blob(chunks, { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = doc.file_name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);

    toast.success(`Downloaded ${doc.file_name}${total > 0 ? ` (${formatBytes(total)})` : ""}`, {
      id: toastId,
    });
    return true;
  } catch (error) {
    toast.error(getErrorMessage(error), { id: toastId });
    return false;
  }
}
