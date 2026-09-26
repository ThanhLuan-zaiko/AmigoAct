import {
  type SpeculationRulesInput,
  speculationRulesJson,
} from "@/lib/speculation-rules";

/**
 * Renders a `<script type="speculationrules">` tag so the browser prefetches
 * or prerenders the listed routes before the user navigates.
 *
 * This is a Server Component — the script is emitted into the page HTML, no
 * client JS needed. Mount it where the "likely next routes" are known, e.g. a
 * page that links onward:
 *
 *   <SpeculationRules prerender={["/activities/new"]} prefetch={["/login"]} />
 *
 * Keep `prerender` lists short — every entry runs the full page lifecycle in
 * a hidden frame.
 */
export function SpeculationRules(props: SpeculationRulesInput) {
  const json = speculationRulesJson(props);
  if (json === null) {
    return null;
  }
  // `json` is produced by speculationRulesJson, which escapes every `<`, so
  // it is safe as raw script children — no dangerouslySetInnerHTML needed.
  return <script type="speculationrules">{json}</script>;
}
