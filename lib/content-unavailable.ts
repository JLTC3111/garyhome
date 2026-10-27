// A transient read failure is not evidence that a public URL was deleted.
// Keep this error generic: SDK errors can contain credentials and request URLs.
export class ContentUnavailableError extends Error {
  constructor() { super("Published content is temporarily unavailable."); this.name = "ContentUnavailableError"; }
}
export function requireAvailableContent<T extends { error: boolean }>(result: T): T {
  if (result.error) throw new ContentUnavailableError();
  return result;
}
