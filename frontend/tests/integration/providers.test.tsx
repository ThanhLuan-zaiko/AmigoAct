/**
 * Integration tests for the client-side providers wrapper — proves the
 * TanStack Query client is mounted and usable by descendants.
 *
 * Layer: **integration**
 */
import { useQuery } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Providers } from "@/components/providers";

describe("Providers", () => {
  it("renders children inside the provider tree", () => {
    render(
      <Providers>
        <p>nội dung con</p>
      </Providers>,
    );

    expect(screen.getByText("nội dung con")).toBeInTheDocument();
  });

  it("gives descendants a working QueryClient via useQuery", async () => {
    function Probe() {
      const { data } = useQuery({
        queryKey: ["probe"],
        queryFn: async () => "đã kết nối",
      });
      return <p>{data ?? "đang tải"}</p>;
    }

    render(
      <Providers>
        <Probe />
      </Providers>,
    );

    expect(screen.getByText("đang tải")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText("đã kết nối")).toBeInTheDocument(),
    );
  });
});
