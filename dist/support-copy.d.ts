/**
 * The long text: what this is, who reads it, and what not to type.
 *
 * Printed by `nmts support --help` and `nmts support send --help`, and by the general help.
 */
export declare const SUPPORT_LONG: readonly string[];
/**
 * The short text, printed once above every preview.
 *
 * ⛔ TWO LINES AND NOT THE LONG ONE. The long text belongs where somebody is deciding whether to
 *    write at all; on the send itself it would be four paragraphs between a person and the thing
 *    they came to do, and text nobody reads protects nobody (owner, 2026-09-03).
 */
export declare const SUPPORT_SHORT: readonly string[];
/** What `--attach-log` attaches, and what has already been taken out of it. */
export declare const ATTACH_LOG_TEXT: readonly string[];
/** One thing a report can be about, with the narrowings the server accepts for it. */
export interface SupportCategory {
    readonly code: string;
    readonly subs: readonly string[];
}
/**
 * What the command line offers.
 *
 * ⛔ A COPY OF THE SERVER'S TABLE (`api/src/domain/support.rs`, `CATEGORIES`) AND NOT ALL OF IT.
 *    The two the server also knows are deliberately not here: `board` is the channel the terms
 *    name for contesting a moderation decision and carries statutory clocks that belong on a
 *    screen where a person reads what they are starting, and `other` is what the server files a
 *    ticket as when none was named — offering it would make "I did not choose" a choice.
 *
 * ⚠ A category the server drops is a 400 naming the field, and the refusal names these. One the
 *   server ADDS is simply not offered here until somebody adds it, which is the safe direction.
 */
export declare const SUPPORT_CATEGORIES: readonly SupportCategory[];
/** The category codes, for a refusal that has to name them. */
export declare function categoryCodes(): string[];
/** The categories and their narrowings, one line each, for the help text. */
export declare function categoryLines(): string[];
/** The usage lines. Kept beside the copy because the two are read together. */
export declare const SUPPORT_USAGE: readonly string[];
/** What `nmts support --help` and `nmts support send --help` print. */
export declare function supportHelpText(): string;
