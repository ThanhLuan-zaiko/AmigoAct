"use client";

import { useState } from "react";

/**
 * Small inline confirm button for destructive or hard-to-undo actions.
 *
 * First click arms the action — the button swaps to an inline
 * "Xác nhận?" + "Hủy" pair (no `window.confirm`, which the design rules
 * forbid). A second click fires `onConfirm`; "Hủy" disarms without acting.
 */
export function ConfirmAction({
  label,
  confirmLabel = "Xác nhận?",
  onConfirm,
  disabled = false,
  busy = false,
  className,
}: {
  /** Idle-state label, e.g. "Hủy hoạt động". */
  label: string;
  /** Armed-state label. Defaults to "Xác nhận?". */
  confirmLabel?: string;
  onConfirm: () => void;
  /** Extra disable (e.g. parent busy). */
  disabled?: boolean;
  /** Show an in-flight state and block interaction. */
  busy?: boolean;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);

  const baseClass =
    className ??
    "rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800";

  if (!armed) {
    return (
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => setArmed(true)}
        className={baseClass}
      >
        {label}
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
        className="rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 disabled:opacity-60 dark:border-red-800 dark:bg-red-950 dark:text-red-300 dark:hover:bg-red-900"
      >
        {busy ? "Đang xử lý…" : confirmLabel}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => setArmed(false)}
        className={baseClass}
      >
        Hủy
      </button>
    </span>
  );
}
