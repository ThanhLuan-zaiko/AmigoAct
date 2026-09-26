/**
 * Unit tests for `lib/speculation-rules.ts` — the Speculation Rules document
 * builder. Pure JSON in/out; no DOM involved.
 *
 * Layer: **unit**
 */
import { describe, expect, it } from "vitest";

import {
  buildSpeculationRules,
  speculationRulesJson,
} from "@/lib/speculation-rules";

describe("buildSpeculationRules", () => {
  it("builds list-source rules with moderate eagerness by default", () => {
    expect(
      buildSpeculationRules({ prefetch: ["/a"], prerender: ["/b"] }),
    ).toEqual({
      prefetch: [{ source: "list", urls: ["/a"], eagerness: "moderate" }],
      prerender: [{ source: "list", urls: ["/b"], eagerness: "moderate" }],
    });
  });

  it("honours an explicit eagerness for every rule", () => {
    const rules = buildSpeculationRules({
      prerender: ["/next"],
      eagerness: "eager",
    });

    expect(rules?.prerender?.[0]?.eagerness).toBe("eager");
  });

  it("returns null when there is nothing to speculate on", () => {
    expect(buildSpeculationRules({})).toBeNull();
    expect(buildSpeculationRules({ prefetch: [] })).toBeNull();
  });

  it("rejects URLs that are not app-relative paths", () => {
    expect(() =>
      buildSpeculationRules({ prefetch: ["https://evil.example/x"] }),
    ).toThrow("app-relative");
  });
});

describe("speculationRulesJson", () => {
  it("serializes the document for the script tag", () => {
    const json = speculationRulesJson({ prefetch: ["/dashboard"] });

    expect(JSON.parse(json ?? "null")).toEqual({
      prefetch: [
        { source: "list", urls: ["/dashboard"], eagerness: "moderate" },
      ],
    });
  });

  it("escapes '<' so a URL cannot break out of the script tag", () => {
    const json = speculationRulesJson({ prefetch: ["/</script><b>"] });

    expect(json).not.toContain("</script>");
    expect(json).toContain("\\u003c");
  });

  it("returns null for an empty ruleset", () => {
    expect(speculationRulesJson({})).toBeNull();
  });
});
