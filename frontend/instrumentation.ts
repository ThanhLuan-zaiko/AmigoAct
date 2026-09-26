/**
 * Next.js server startup hook — runs once per server instance.
 *
 * Probes the backend configured via NEXT_PUBLIC_API_URL (see `.env.local`)
 * and logs the outcome to the server console only; nothing reaches the
 * browser bundle or the rendered page.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  const { apiUrl } = await import("@/lib/config");
  const { checkApiHealth } = await import("@/lib/health");

  const url = apiUrl("/api/health");
  const result = await checkApiHealth();
  if (result.ok) {
    console.info(
      `[api] backend reachable: ${url} (${result.app} v${result.version}, ${result.environment})`,
    );
  } else {
    console.warn(`[api] backend unreachable: ${url} - ${result.reason}`);
  }
}
