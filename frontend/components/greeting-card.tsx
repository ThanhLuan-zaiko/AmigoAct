"use client";

import { useId, useState } from "react";

import { buildGreeting, DEFAULT_GREETING } from "@/lib/greeting";

export interface GreetingCardProps {
  /** Lời chào ban đầu, ví dụ `"Xin chào"` hoặc `"Chào buổi sáng"`. */
  greeting?: string;
}

/**
 * A controlled input that renders a live greeting preview.
 *
 * Present purely as the integration-test target: it holds state, calls a
 * domain helper and renders the result, so it exercises the full unit →
 * integration path in one component.
 *
 * User-facing strings are Vietnamese. See AGENTS.md > Language convention.
 */
export function GreetingCard({
  greeting = DEFAULT_GREETING,
}: GreetingCardProps) {
  const inputId = useId();
  const [name, setName] = useState("");

  return (
    <section aria-labelledby={`${inputId}-heading`}>
      <h2 id={`${inputId}-heading`}>Xem trước lời chào</h2>
      <label htmlFor={inputId}>Tên của bạn</label>
      <input
        id={inputId}
        name="name"
        type="text"
        value={name}
        placeholder="Nhập tên"
        onChange={(event) => setName(event.target.value)}
      />
      <p data-testid="greeting-output">{buildGreeting(name, greeting)}</p>
    </section>
  );
}
