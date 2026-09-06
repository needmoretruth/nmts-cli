/** What an agent may decide without asking. */
export type Autonomy = "default" | "auto-low" | "auto-high" | "skip-permissions";
export declare const AUTONOMY_MODES: readonly Autonomy[];
/** What each mode means, in the words the tool prints. One line each, no more. */
export declare const MODE_MEANS: Readonly<Record<Autonomy, string>>;
/**
 * The whole explanation of one mode — what it is, what can go wrong, what is gained, and the way
 * out. ⛔ AN AGENT THAT RECOMMENDS A MODE SHOWS THIS TEXT, whole, to the person (AGENTS.md).
 */
export declare function explain(mode: Autonomy): string[];
/** The sentence a person types to turn skip-permissions on. Nobody types it by accident. */
export declare const SKIP_SENTENCE = "NOTHING WILL ASK ME AND I ACCEPT THAT";
/** Whether an agent, rather than a person, is taken to be driving. */
export declare function isAgentMode(mode: Autonomy): boolean;
/**
 * Read a stored name, including the two this tool wrote before 2026-09-06: `off` is `default`
 * and `auto` is `auto-low`. Anything else counts as `default`.
 */
export declare function modeFromStored(value: unknown): Autonomy;
/**
 * What this machine is set to.
 *
 * ⛔ Unreadable counts as `default`. The fail-safe direction for "I do not know" is the one where
 *    somebody is still asked -- a file that switches autonomy on when it cannot be parsed is worse
 *    than no file at all.
 */
export declare function currentMode(): Autonomy;
/** When it was set, or null when it is default or unreadable. */
export declare function setAt(): string | null;
/** Write the choice down, with the date and the version that was asked. */
export declare function setMode(mode: Autonomy, version: string, now: Date): void;
/**
 * The line every run prints when a mode is on.
 *
 * ⛔ IT IS PRINTED EVERY TIME, not once. A setting that stops announcing itself is a setting people
 *    forget they turned on, and this one decides whether anybody is asked before money is spent.
 *    ⚠ It goes to stderr: stdout belongs to whatever is reading this tool's output.
 */
export declare function announcement(mode: Autonomy): string | null;
