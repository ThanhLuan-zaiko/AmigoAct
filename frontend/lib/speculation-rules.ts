/**
 * Builder for the Speculation Rules API — the navigation-speed half of the
 * app's realtime backbone (the other half is the WebSocket channel in
 * `lib/websocket.ts`).
 *
 * Framework-free: this module produces the JSON document; the
 * `<SpeculationRules>` component in `components/speculation-rules.tsx`
 * renders it into `<script type="speculationrules">`.
 *
 * Speculation rules tell the browser to `prefetch` or `prerender` URLs it
 * believes the user will visit next. `prerender` renders the whole page in a
 * hidden frame, so navigation is instant — but it executes the target page's
 * scripts, so only prerender same-origin app routes that are safe to run
 * without a user gesture.
 */
export type SpeculationEagerness =
  | "immediate"
  | "eager"
  | "moderate"
  | "conservative";

export interface SpeculationRulesInput {
  /** Same-origin paths to fetch ahead of time. */
  readonly prefetch?: readonly string[];
  /** Same-origin paths to fully render ahead of time. Use sparingly. */
  readonly prerender?: readonly string[];
  /** How aggressively the browser may speculate. Defaults to "moderate". */
  readonly eagerness?: SpeculationEagerness;
}

interface ListSourceRule {
  source: "list";
  urls: string[];
  eagerness: SpeculationEagerness;
}

export interface SpeculationRules {
  prefetch?: ListSourceRule[];
  prerender?: ListSourceRule[];
}

const DEFAULT_EAGERNESS: SpeculationEagerness = "moderate";

/**
 * Build the speculation-rules document, or `null` when there is nothing to
 * speculate on (so the component can render nothing at all).
 *
 * Throws on a URL that is not an app-relative path — absolute or malformed
 * URLs in a shipped rule are a bug, not a state to silently keep.
 */
export function buildSpeculationRules(
  input: SpeculationRulesInput,
): SpeculationRules | null {
  const eagerness = input.eagerness ?? DEFAULT_EAGERNESS;
  const rules: SpeculationRules = {};

  if (input.prefetch?.length) {
    rules.prefetch = [
      { source: "list", urls: validateUrls(input.prefetch), eagerness },
    ];
  }
  if (input.prerender?.length) {
    rules.prerender = [
      { source: "list", urls: validateUrls(input.prerender), eagerness },
    ];
  }

  return Object.keys(rules).length > 0 ? rules : null;
}

/**
 * Serialize rules for `<script type="speculationrules">` injection.
 * `<` is escaped to `\u003c` so a URL can never break out of the script tag.
 */
export function speculationRulesJson(
  input: SpeculationRulesInput,
): string | null {
  const rules = buildSpeculationRules(input);
  if (rules === null) {
    return null;
  }
  return JSON.stringify(rules).replace(/</g, "\\u003c");
}

function validateUrls(urls: readonly string[]): string[] {
  for (const url of urls) {
    if (!url.startsWith("/")) {
      throw new Error(
        `speculation rule URLs must be app-relative paths, got: ${url}`,
      );
    }
  }
  return [...urls];
}
