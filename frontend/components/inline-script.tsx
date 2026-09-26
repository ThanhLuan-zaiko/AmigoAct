/**
 * Inline `<script>` helper for code that must run before first paint.
 *
 * From the Next.js "Preventing flash before hydration" guide: on the server
 * the script is real (`text/javascript`) so the browser executes it during
 * HTML parsing; on the client it renders `text/plain` — inert — because
 * scripts inserted via React DOM updates would not run anyway, and React
 * warns in dev when a component tree emits live `<script>` tags.
 * `suppressHydrationWarning` covers the type attribute mismatch.
 *
 * Deliberately no `"use client"`: it must stay usable from Server Components
 * (the root layout) while remaining safe inside Client Components.
 */
export function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      // Safe by contract: callers pass a static, hand-written script literal
      // — never user or network input. This is the documented pattern from
      // the Next.js "Preventing flash before hydration" guide; there is no
      // alternative that runs during HTML parsing.
      // biome-ignore lint/security/noDangerouslySetInnerHtml: the bootstrap script is a static literal — see the comment above.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
