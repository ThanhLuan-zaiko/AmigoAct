/**
 * Integration test for `<InlineScript>` — emits a real `<script>` carrying
 * the given code, rendered as inert `text/plain` on the client.
 *
 * Layer: **integration**
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { InlineScript } from "@/components/inline-script";

describe("InlineScript", () => {
  it("emits the script body verbatim", () => {
    const { container } = render(
      <InlineScript html={'document.documentElement.dataset.x="1"'} />,
    );

    const script = container.querySelector("script");
    expect(script).not.toBeNull();
    expect(script?.textContent).toBe('document.documentElement.dataset.x="1"');
    // In a DOM environment the script is inert — type text/plain.
    expect(script?.getAttribute("type")).toBe("text/plain");
  });
});
