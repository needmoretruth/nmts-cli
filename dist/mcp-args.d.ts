/**
 * Keywords a schema uses that this checker does not enforce.
 *
 * ⛔ THE POINT IS THAT IT IS NOT EMPTY-BY-ASSUMPTION. A checker that silently skips what it does
 *    not understand still returns "no problems", and a schema that grew a `minimum` or a `oneOf`
 *    would go on being advertised while nothing held it. A test compares this against the real
 *    tool table, so growing a schema past this file turns something red.
 */
export declare function unsupported(schema: unknown): string[];
/**
 * Compare one call's arguments against the schema its tool advertised.
 *
 * Returns the problems, most important first: a missing required argument before a wrong type,
 * because a caller that forgot one is usually about to be told about the other for the same reason.
 * An empty array means the call may proceed.
 */
export declare function checkArgs(schema: unknown, args: unknown): string[];
