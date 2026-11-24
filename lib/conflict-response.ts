export function isConflictResponse(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, status } = error as { code?: string | number; status?: string | number };
  return code === "PT409" || String(code) === "409" || Number(status) === 409;
}
