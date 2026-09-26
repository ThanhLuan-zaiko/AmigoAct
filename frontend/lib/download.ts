/**
 * Browser download helper for in-memory Blobs — e.g. the PDF certificate
 * returned by `apiFetchBlob`.
 *
 * Creates a temporary object URL, clicks a programmatic `<a download>` and
 * revokes the URL one tick later: revoking synchronously can cancel the
 * download in browsers that resolve the blob URL after the click returns.
 *
 * Framework-free; jsdom-testable (stub `URL.createObjectURL`/`revokeObjectURL`
 * and spy on `HTMLAnchorElement.prototype.click`).
 */

/** Build the certificate filename for a record: `chung-nhan-<id>.pdf`. */
export function certificateFilename(recordId: string): string {
  return `chung-nhan-${recordId}.pdf`;
}

/** Trigger a file download of `blob` under `filename`. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
