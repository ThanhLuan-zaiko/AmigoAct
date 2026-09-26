"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { normalizeCheckinCode } from "@/lib/checkin";

import { CheckinConfirm } from "./checkin-confirm";
import { CheckinManual } from "./checkin-manual";

/**
 * QR scan landing. The QR encodes `/checkin?a=<activity>&c=<code>`:
 *
 *   - both params present and the code valid → confirm card (explicit
 *     "Điểm danh" button — never auto-submit);
 *   - params missing or malformed → honest notice + the manual flow
 *     (paste box / approved-activity picker).
 */
export function CheckinView() {
  const searchParams = useSearchParams();
  const a = searchParams.get("a");
  const c = searchParams.get("c");

  const urlTarget =
    a !== null && c !== null && normalizeCheckinCode(c) !== null
      ? { activityId: a, code: normalizeCheckinCode(c) as string }
      : null;
  const invalidLink = (a !== null || c !== null) && urlTarget === null;

  const [picked, setPicked] = useState<{
    activityId: string;
    code: string;
  } | null>(null);
  const target = urlTarget ?? picked;

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-10">
      {invalidLink && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
        >
          Liên kết điểm danh không hợp lệ — hãy quét lại mã QR hoặc nhập mã bên
          dưới.
        </p>
      )}
      {target !== null ? (
        <CheckinConfirm activityId={target.activityId} code={target.code} />
      ) : (
        <CheckinManual onTarget={setPicked} />
      )}
    </div>
  );
}
