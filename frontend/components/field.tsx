"use client";

import {
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
  useId,
} from "react";

/**
 * Shared control styling for text inputs, selects and textareas inside
 * forms — keeps every form field visually identical.
 */
export const FIELD_INPUT_CLASS =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:border-neutral-500";

function FieldFeedback({
  error,
  hint,
}: {
  error?: string | null;
  hint?: string;
}) {
  if (error !== undefined && error !== null) {
    return (
      <p role="alert" className="text-xs text-red-600 dark:text-red-400">
        {error}
      </p>
    );
  }
  if (hint !== undefined) {
    return (
      <p className="text-xs text-neutral-500 dark:text-neutral-400">{hint}</p>
    );
  }
  return null;
}

interface FieldShellProps {
  label: string;
  /** Field-level error message — wins over `hint`. */
  error?: string | null;
  /** Helper text shown while the field is valid. */
  hint?: string;
}

/**
 * Label + control + hint/error shell for forms. The control is supplied as
 * a render prop so `<label htmlFor>` and the control's `id` always agree:
 *
 *   <Field label="Ghi chú">
 *     {(id) => <select id={id} … />}
 *   </Field>
 *
 * Prefer {@link InputField} / {@link TextareaField} for plain controls.
 */
export function Field({
  label,
  error,
  hint,
  children,
}: FieldShellProps & { children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children(id)}
      <FieldFeedback error={error} hint={hint} />
    </div>
  );
}

/** `<Field>` wrapping a plain `<input>` — the common case. */
export function InputField({
  label,
  error,
  hint,
  ...inputProps
}: FieldShellProps & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Field label={label} error={error} hint={hint}>
      {(id) => (
        <input
          id={id}
          {...inputProps}
          className={inputProps.className ?? FIELD_INPUT_CLASS}
        />
      )}
    </Field>
  );
}

/** `<Field>` wrapping a `<textarea>`. */
export function TextareaField({
  label,
  error,
  hint,
  ...textareaProps
}: FieldShellProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Field label={label} error={error} hint={hint}>
      {(id) => (
        <textarea
          id={id}
          {...textareaProps}
          className={textareaProps.className ?? FIELD_INPUT_CLASS}
        />
      )}
    </Field>
  );
}
