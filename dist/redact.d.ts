/**
 * One thing that is taken out, and how it is recognised.
 *
 * ⛔ DATA, NOT A CHAIN OF `if`s. The rules are read by a test one at a time, and a rule that
 *    exists only inside a function body is a rule nobody can enumerate.
 */
export interface RedactionRule {
    /** What replaces the match. Written in the report, so it says what stood there. */
    readonly label: string;
    /** ⚠ Global. `redact` relies on `replaceAll` semantics and resets nothing. */
    readonly test: RegExp;
    /**
     * A second opinion on a match, for shapes a regular expression cannot decide alone.
     *
     * The NMTS key is the one that needs it: recognising it is "exactly thirty-three symbols
     * once the separators are gone", which is a count and not a pattern.
     */
    readonly only?: (match: string) => boolean;
    /**
     * What the match becomes, when part of it has to stay.
     *
     * `token=…` is the case: the name is what makes the label readable, so the name stays and only
     * the value goes.
     */
    readonly into?: (match: string, groups: readonly (string | undefined)[]) => string;
}
/**
 * The rules, in the order they run.
 *
 * ⛔ ORDER IS PART OF EACH RULE. The narrow shapes go first so that the value gets the label that
 *    names it — an API key becomes `[api-key]` and not the `[secret]` that the catch-all run of
 *    key material would have given it. The catch-all rules go last, over a text where everything
 *    recognisable has already become a label, and a label is too short for them to match.
 */
export declare const RULES: readonly RedactionRule[];
/**
 * The values this process is actually holding, whatever they look like.
 *
 * ⛔ READ AT REDACTION TIME, NOT AT IMPORT TIME. A command that sets a variable for a child, a
 *    test that swaps one, and a shell that exported one after this module loaded would all defeat
 *    a snapshot taken once.
 *
 * ⛔ EVERY `NMTS_*` VARIABLE, NOT THE THREE THAT ARE OBVIOUSLY SECRET. The cost of labelling a
 *    server address is one word in a report; the cost of a variable added next year that nobody
 *    thought to add here is the value itself.
 *
 * ⚠ LONGEST FIRST. Two variables holding one value inside the other would otherwise leave the
 *   longer one half-labelled, which is a value partly in the clear.
 */
export declare function environmentRules(): RedactionRule[];
/**
 * Take the secrets out of a text.
 *
 * ⛔ THE ENVIRONMENT GOES FIRST. A value this process is holding is known to be a secret, and a
 *    label naming the variable it came from (`[env:NMTS_API_KEY]`) says more to whoever reads the
 *    report than the shape-based label would.
 */
export declare function redact(text: string): string;
/** The label a value named with `--omit` becomes. */
export declare const OMITTED = "[omitted]";
/** Values shorter than this are refused: two characters match half a text. */
export declare const SHORTEST_OMIT = 3;
/**
 * Replace values the caller named, on top of everything `redact` finds.
 *
 * ⛔ LITERAL, NOT A PATTERN. What is passed is a file name or a folder somebody typed, and
 *    treating it as a regular expression would turn a dot into "any character" and a bracket into
 *    a syntax error in somebody's report.
 */
export declare function omitLiterals(text: string, values: readonly string[]): string;
