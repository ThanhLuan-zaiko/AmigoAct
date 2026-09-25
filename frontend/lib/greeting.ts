/**
 * Greeting helpers shared by the UI and the API client.
 *
 * Kept free of React and of `next/*` imports so it can be unit tested in
 * isolation — see `tests/unit/test-greeting.test.ts`.
 *
 * User-facing strings are Vietnamese. See AGENTS.md > Language convention.
 */

export const DEFAULT_NAME = "bạn";
export const DEFAULT_GREETING = "Xin chào";
export const MAX_NAME_LENGTH = 80;

export class InvalidNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidNameError";
  }
}

/** Collapse surrounding and repeated whitespace. */
export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/**
 * Build a greeting string.
 *
 * @throws {InvalidNameError} when `name` is blank or longer than
 * {@link MAX_NAME_LENGTH}.
 */
export function buildGreeting(
  name?: string | null,
  greeting: string = DEFAULT_GREETING,
): string {
  const salutation = normalizeName(greeting) || DEFAULT_GREETING;
  if (name === undefined || name === null || name.trim().length === 0) {
    return `${salutation}, ${DEFAULT_NAME}!`;
  }
  const cleaned = normalizeName(name);
  if (cleaned.length > MAX_NAME_LENGTH) {
    throw new InvalidNameError(
      `name must be at most ${MAX_NAME_LENGTH} characters, got ${cleaned.length}`,
    );
  }
  return `${salutation}, ${cleaned}!`;
}
