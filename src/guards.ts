// Narrowing `unknown` without asserting.
//
// ⛔ WHY A MODULE FOR THIS. Everything that arrives from outside this program — a server answer, a
//    tool call's arguments, a file somebody wrote — starts as `unknown`, and the shortest way to
//    use it is `value as Record<string, unknown>`. That assertion compiles whether or not the check
//    above it is right, and it keeps compiling after somebody edits the check. A predicate makes
//    the compiler carry the narrowing instead, so the two can never drift apart.
//
// ⚠ ARRAYS ARE NOT RECORDS HERE. `typeof [] === "object"` and `[] !== null`, so the obvious
//   two-part check lets an array through as an object — which is how a JSON array ends up being
//   read for named fields and quietly answering `undefined` to every one of them.

/** True for a plain JSON object: not null, not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
