/**
 * Unit tests for `lib/download.ts` — the object-URL lifecycle behind the
 * certificate download: create → anchor click → deferred revoke.
 *
 * jsdom implements neither `URL.createObjectURL` nor real downloads, so the
 * URL API is stubbed and the anchor's `click` is spied on — the assertion is
 * about what we *ask* the browser to do, not an actual file.
 *
 * Layer: **unit**
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { certificateFilename, downloadBlob } from "@/lib/download";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/**
 * Stub the object-URL API + anchor click; returns the recorded state.
 * `URL` is replaced by a subclass — spreading it (`{...URL}`) would drop
 * the constructor and break every `new URL()` in the fetch mock.
 */
function stubUrlApi() {
  const urls: string[] = [];
  const revoked: string[] = [];
  class MockURL extends URL {
    static override createObjectURL(blob: Blob | MediaSource): string {
      const url = `blob:mock/${urls.length}`;
      urls.push(url);
      void blob;
      return url;
    }
    static override revokeObjectURL(url: string): void {
      revoked.push(url);
    }
  }
  vi.stubGlobal("URL", MockURL);
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  return { urls, revoked, click };
}

describe("certificateFilename", () => {
  it("builds the agreed chung-nhan-<id>.pdf name", () => {
    expect(certificateFilename("rec-1")).toBe("chung-nhan-rec-1.pdf");
  });
});

describe("downloadBlob", () => {
  it("creates an object URL, clicks a download anchor, revokes on a tick", () => {
    vi.useFakeTimers();
    const { urls, revoked, click } = stubUrlApi();
    const blob = new Blob(["%PDF-1.4"], { type: "application/pdf" });

    downloadBlob(blob, "chung-nhan-rec-1.pdf");

    expect(urls).toHaveLength(1);
    expect(click).toHaveBeenCalledTimes(1);
    // The anchor was attached (Safari needs it in the DOM), carried the
    // object URL and the download name, then was removed again.
    const anchor = document.querySelector("a[download]");
    expect(anchor).toBeNull();
    // `mock.contexts` records the `this` the anchor click ran on.
    expect(click.mock.contexts[0]).toBeInstanceOf(HTMLAnchorElement);
    const clicked = click.mock.contexts[0] as HTMLAnchorElement;
    expect(clicked.href).toBe(urls[0]);
    expect(clicked.download).toBe("chung-nhan-rec-1.pdf");
    // Revocation is deferred so the browser resolves the URL first.
    expect(revoked).toHaveLength(0);
    vi.runAllTimers();
    expect(revoked).toEqual(urls);
  });
});
