// The shape of a refusal the server sends, and the check that recognises one. The advice table
// for each refusal code stays in api.ts, which is where the repository's checks read it.
export interface ServerRefusal {
  code: string;
  message: string;
  /**
   * Whatever the refusal carries beside its words — a limit that was hit, an address to go to.
   *
   * ⚠ Values are not all numbers: `AGENT_VERIFY_REQUIRED` names the page a person opens. Nothing
   *   here validates the shape, so a narrower type than the wire's would be a claim, not a check.
   */
  details?: Record<string, string | number>;
}

export function isRefusal(value: unknown): value is { error: ServerRefusal } {
  if (typeof value !== "object" || value === null || !("error" in value)) return false;
  const error: unknown = Reflect.get(value, "error");
  if (typeof error !== "object" || error === null) return false;
  return typeof Reflect.get(error, "code") === "string" && typeof Reflect.get(error, "message") === "string";
}
