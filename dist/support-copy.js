// Every sentence `nmts support` shows a person, in one place.
//
// ⛔ WRITTEN ONCE AND IMPORTED, NEVER RETYPED. The same words are printed by the help text, by the
//    preview above every send, and by the MCP tool descriptions. A second copy is how one of them
//    starts saying something the others do not — and what these particular sentences promise is
//    what is taken out of a message before it leaves the machine, which is not a promise to keep
//    in two versions.
//
// ⛔ IT HAS NO IMPORTS AND MUST NOT GROW ANY. `help.ts` reads it, and `nmts --help` is measured
//    (`check:cli-startup`): a module that pulled the command in behind it would make every run of
//    the help text load the server client.
//
// ⛔ ENGLISH ONLY, LIKE THE WHOLE OF THIS PACKAGE (owner, 2026-09-03). Korean lives in
//    `README.ko.md` and nowhere else in `cli/`.
/**
 * The long text: what this is, who reads it, and what not to type.
 *
 * Printed by `nmts support --help` and `nmts support send --help`, and by the general help.
 */
export const SUPPORT_LONG = [
    "Send a message to the person who builds NMTS: a bug, an error, an idea, a question, or",
    "anything else. It lands in the same inbox as the app's contact form, and replies come",
    "back to this thread (`nmts support show <code>`).",
    "",
    "NMTS is built and run by one developer. I test it hard as a user myself, and on my own",
    "that is nowhere near enough. The tiniest report counts, and so does anything you are not",
    "sure is a bug. Every message is read, seriously.",
    "",
    "Write in English if you can. Korean is read too; if Korean is not your own language,",
    "English is the better choice.",
    "",
    "Keep personal details out. Your NMTS key, API key, passphrase and file contents are",
    "removed on this machine before anything is sent; file names and your public code may go.",
    "Please do not type your name, address, health or anything else about yourself. The form",
    "does not need it, and this inbox is the wrong place for it.",
];
/**
 * The short text, printed once above every preview.
 *
 * ⛔ TWO LINES AND NOT THE LONG ONE. The long text belongs where somebody is deciding whether to
 *    write at all; on the send itself it would be four paragraphs between a person and the thing
 *    they came to do, and text nobody reads protects nobody (owner, 2026-09-03).
 */
export const SUPPORT_SHORT = [
    "This goes to the developer of NMTS and is read. Leave personal details out: your NMTS key,",
    "API key and file contents are stripped here before sending. English preferred; Korean is read too.",
];
/** What `--attach-log` attaches, and what has already been taken out of it. */
export const ATTACH_LOG_TEXT = [
    "--attach-log adds the CLI's own record of its last runs: the commands, the server's",
    "answers and any error text. It is written already redacted (NMTS keys, API keys,",
    "passphrases, tokens and key material become labels before they touch the disk) and is",
    "redacted once more when attached. You do not need to read it before sending. If you know",
    "a value that must not travel, add --omit <text> and it is replaced too.",
];
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
export const SUPPORT_CATEGORIES = [
    { code: "bug", subs: ["upload", "download", "files", "wallet", "signin", "display", "other"] },
    { code: "idea", subs: ["files", "sharing", "wallet", "app", "other"] },
    { code: "account", subs: ["signin", "lostcode", "devices", "delete", "other"] },
    { code: "storage", subs: ["extend", "expiry", "erase", "network", "other"] },
    { code: "payment", subs: ["failed", "amount", "credits", "trial", "other"] },
    { code: "privacy", subs: ["mydata", "removal", "legal", "security", "other"] },
];
/** The category codes, for a refusal that has to name them. */
export function categoryCodes() {
    return SUPPORT_CATEGORIES.map((c) => c.code);
}
/** The categories and their narrowings, one line each, for the help text. */
export function categoryLines() {
    return SUPPORT_CATEGORIES.map((c) => `  ${c.code.padEnd(10)}${c.subs.join(" · ")}`);
}
/** The usage lines. Kept beside the copy because the two are read together. */
export const SUPPORT_USAGE = [
    "  nmts support send --category <c> [--sub <s>] (--message <text> | --message-file <path>)",
    "  nmts support send --category <c> --attach-log [n] [--omit <text>] [--yes] [--json]",
    "  nmts support list",
    "  nmts support show <code>",
    "  nmts support reply <code> --message <text>",
];
/** What `nmts support --help` and `nmts support send --help` print. */
export function supportHelpText() {
    return [
        "nmts support — write to the developer of NMTS.",
        "",
        "USAGE",
        ...SUPPORT_USAGE,
        "",
        ...SUPPORT_LONG,
        "",
        "CATEGORIES",
        ...categoryLines(),
        "",
        "THE LOG",
        ...ATTACH_LOG_TEXT,
        "",
    ].join("\n");
}
