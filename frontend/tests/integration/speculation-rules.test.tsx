/**
 * Integration tests for `<SpeculationRules>` — the component emits a real
 * `<script type="speculationrules">` tag into the DOM.
 *
 * Layer: **integration**
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SpeculationRules } from "@/components/speculation-rules";

describe("SpeculationRules", () => {
  it("renders the rules as a speculationrules script tag", () => {
    const { container } = render(
      <SpeculationRules prerender={["/activities"]} prefetch={["/login"]} />,
    );

    const script = container.querySelector('script[type="speculationrules"]');
    expect(script).not.toBeNull();
    expect(JSON.parse(script?.innerHTML ?? "null")).toEqual({
      prerender: [
        { source: "list", urls: ["/activities"], eagerness: "moderate" },
      ],
      prefetch: [{ source: "list", urls: ["/login"], eagerness: "moderate" }],
    });
  });

  it("renders nothing when no routes are given", () => {
    const { container } = render(<SpeculationRules />);

    expect(
      container.querySelector('script[type="speculationrules"]'),
    ).toBeNull();
  });
});
