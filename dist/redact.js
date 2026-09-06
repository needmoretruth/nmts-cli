// Taking out of a text the things that must never leave this machine.
//
// ⛔ IT RUNS BEFORE ANYTHING IS WRITTEN OR SENT, NOT AFTER. The run log is redacted on the way to
//    the disk and a support message is redacted on the way to the wire, so a file somebody copies
//    off this machine and a request somebody intercepts both carry labels rather than values. A
//    filter applied at the last moment would still leave the real thing lying in a file.
//
// ⛔ IT ERRS TOWARD REPLACING. A label where an ordinary word stood costs the reader one word and
//    is visible in the preview; a missed NMTS key costs the whole account and is visible to
//    nobody. Every rule below is written on that side of the line, and the tests pin both
//    directions — one text each rule must replace, one text it must leave alone.
//
// ⛔ THE MATCH IS REPLACED BY A LABEL, NOT BY STARS. `[account-code]` tells the person reading the
//    report what stood there, which is often the useful half of the sentence ("I pasted
//    [account-code] and it said ..."), and a row of asterisks does not.
//
// ⚠ WHAT IT CANNOT DO. It knows the SHAPES this product uses and the values this process can see.
//   A secret belonging to something else, written in prose ("my password is hunter2"), is not a
//   shape and is not in this process's environment, and nothing here will find it. That is why the
//   text a person reads before sending asks them to keep personal details out: the machine covers
//   what a machine can recognise, and the sentence covers the rest.
/** An NMTS key is 32 data symbols and one check symbol. `crypto/src/codes.rs` is the origin. */
const ACCOUNT_CODE_SYMBOLS = 33;
/** Crockford base32, the data half: `0-9 A-H J-K M-N P-T V-Z`, either case. No `I L O U`. */
const DATA_CLASS = "0-9A-HJKMNP-TV-Za-hjkmnp-tv-z";
/** The check symbol may also be one of the five Crockford extras. */
const CHECK_CLASS = `${DATA_CLASS}*~$=Uu`;
const DATA_ONLY = new RegExp(`^[${DATA_CLASS}]+$`, "u");
const CHECK_ONLY = new RegExp(`^[${CHECK_CLASS}]$`, "u");
/**
 * Is this run of symbols an NMTS key?
 *
 * ⛔ THE GROUPS MUST BE THREE SYMBOLS OR MORE. Without that, a hyphenated phrase of single letters
 *    adding up to thirty-three would be replaced, and error sentences are exactly where hyphens
 *    live. The display form the product prints is groups of four, so nothing real is excluded.
 */
function looksLikeAnAccountCode(candidate) {
    const groups = candidate.split("-");
    if (groups.some((group) => group.length < 3))
        return false;
    const symbols = groups.join("");
    if (symbols.length !== ACCOUNT_CODE_SYMBOLS)
        return false;
    return DATA_ONLY.test(symbols.slice(0, -1)) && CHECK_ONLY.test(symbols.slice(-1));
}
/**
 * The rules, in the order they run.
 *
 * ⛔ ORDER IS PART OF EACH RULE. The narrow shapes go first so that the value gets the label that
 *    names it — an API key becomes `[api-key]` and not the `[secret]` that the catch-all run of
 *    key material would have given it. The catch-all rules go last, over a text where everything
 *    recognisable has already become a label, and a label is too short for them to match.
 */
export const RULES = [
    {
        // A whole PEM block, header to footer. Its body is standard base64, which the run rule below
        // deliberately does not cover, so this has to take the block rather than the first line.
        label: "[secret]",
        test: /-----BEGIN[^\n-]*-----[\s\S]*?-----END[^\n-]*-----/g,
    },
    {
        // A header with no footer: a key that was pasted half-way, which is still most of a key.
        label: "[secret]",
        test: /-----BEGIN[^\n]*/g,
    },
    {
        // Sui's own spelling of a private key. It is bech32, so the tail is lower-case alphanumerics.
        label: "[secret]",
        test: /\bsuiprivkey1[0-9a-z]+/gi,
    },
    {
        // `api-key.ts` has the exact shape: the prefix, a 12-symbol handle, `_`, and 43 more.
        label: "[api-key]",
        test: /nmts_ak1_[A-Za-z0-9_-]+/g,
    },
    {
        // Hyphen-separated or run together — the two spellings a person copies. Whitespace grouping
        // is the rule below, kept separate because a maximal run over spaces would swallow the
        // sentence the code sits in and then fail to recognise it.
        //
        // ⚠ The five extended check symbols are allowed only at the END. Letting `=` stand inside the
        //   run glued `--message=` to the code that followed it and the pair then matched nothing.
        label: "[account-code]",
        test: new RegExp(`(?<![0-9A-Za-z])[${DATA_CLASS}]{3,}(?:-[${DATA_CLASS}]{3,})*[*~$=Uu]?(?![0-9A-Za-z])`, "gu"),
        only: looksLikeAnAccountCode,
    },
    {
        // The display form with spaces where the dashes are: seven groups of four, then five.
        label: "[account-code]",
        test: new RegExp(`(?<![0-9A-Za-z])[${DATA_CLASS}]{4}(?: [${DATA_CLASS}]{4}){6} [${DATA_CLASS}]{4}[${CHECK_CLASS}](?![0-9A-Za-z])`, "gu"),
    },
    {
        // ⛔ THE NAME STAYS AND THE VALUE GOES. `Authorization: [secret]` is still a sentence somebody
        //    can act on; `[secret]` alone is not. The prefix is widened to anything ending in `token`
        //    or `key` so that `api_key=` and `access_token=` are covered by one rule rather than three.
        label: "[secret]",
        // ⚠ `(?!\[)` KEEPS A LABEL A RULE ABOVE ALREADY PUT THERE. Without it `key=[api-key]` became
        //   `key=[secret]`, which is not wrong but is less useful: the narrower label is the one that
        //   says what stood there.
        test: /\b(authorization\s*:\s*bearer|[A-Za-z0-9_]*(?:token|key)\s*=)\s*("?)(?!\[)[^\s"'&]+\2/gi,
        into: (_match, groups) => {
            const prefix = groups[0] ?? "";
            return prefix.endsWith("=") ? `${prefix}[secret]` : `${prefix} [secret]`;
        },
    },
    {
        // Key material, session tokens, ciphertext: 43 symbols is the length of base64url over 32
        // bytes, which is what every secret this product handles decodes to.
        //
        // ⛔ BOTH CASES REQUIRED, AND THAT IS WHAT KEEPS FILE NAMES. `screenshot-2026-09-04-at-...`
        //    is base64url's alphabet too, and long names built out of hyphenated lower-case words are
        //    ordinary. Random 43-symbol material without a single capital happens about once in ten
        //    billion times; a lower-case file name happens every day.
        label: "[secret]",
        test: /(?<![A-Za-z0-9_-])(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*[a-z])[A-Za-z0-9_-]{43,}(?![A-Za-z0-9_-])/g,
    },
    {
        // Hex of the same weight — a hash, a chain digest, a raw key written out.
        label: "[secret]",
        test: /(?<![A-Za-z0-9])[0-9a-f]{43,}(?![A-Za-z0-9])/gi,
    },
    {
        // ⛔ A SEED PHRASE, WHICH THIS TOOL NEVER HOLDS AND A PERSON MIGHT STILL PASTE. The wallet
        //    here is derived from the NMTS key and there is no mnemonic anywhere in it — but
        //    somebody reporting a wallet problem has another wallet open, and twelve words is what
        //    that one shows them.
        //
        // ⛔ THE COUNT IS EXACT AND THE RUN IS MAXIMAL. Only a whole run of exactly twelve or
        //    twenty-four short lower-case words is replaced, so a sentence that happens to contain
        //    twelve of them among longer words, capitals, digits or punctuation is left alone.
        label: "[words]",
        test: /\b[a-z]{3,8}(?:\s+[a-z]{3,8})*\b/g,
        only: (match) => {
            const count = match.split(/\s+/u).length;
            return count === 12 || count === 24;
        },
    },
];
/** Below this length a variable's value is too short to be a credential and too likely to be a word. */
const SHORTEST_ENV_VALUE = 8;
function escapeForRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
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
export function environmentRules() {
    const found = [];
    for (const [name, value] of Object.entries(process.env)) {
        if (!name.startsWith("NMTS_"))
            continue;
        if (value === undefined || value.length < SHORTEST_ENV_VALUE)
            continue;
        found.push({ name, value });
    }
    found.sort((a, b) => b.value.length - a.value.length);
    return found.map((v) => ({ label: `[env:${v.name}]`, test: new RegExp(escapeForRegExp(v.value), "g") }));
}
function apply(text, rule) {
    return text.replace(rule.test, (match, ...rest) => {
        if (rule.only !== undefined && !rule.only(match))
            return match;
        const groups = rest.filter((v) => typeof v === "string" || v === undefined);
        return rule.into === undefined ? rule.label : rule.into(match, groups);
    });
}
/**
 * Take the secrets out of a text.
 *
 * ⛔ THE ENVIRONMENT GOES FIRST. A value this process is holding is known to be a secret, and a
 *    label naming the variable it came from (`[env:NMTS_API_KEY]`) says more to whoever reads the
 *    report than the shape-based label would.
 */
export function redact(text) {
    let out = text;
    for (const rule of environmentRules())
        out = apply(out, rule);
    for (const rule of RULES)
        out = apply(out, rule);
    return out;
}
/** The label a value named with `--omit` becomes. */
export const OMITTED = "[omitted]";
/** Values shorter than this are refused: two characters match half a text. */
export const SHORTEST_OMIT = 3;
/**
 * Replace values the caller named, on top of everything `redact` finds.
 *
 * ⛔ LITERAL, NOT A PATTERN. What is passed is a file name or a folder somebody typed, and
 *    treating it as a regular expression would turn a dot into "any character" and a bracket into
 *    a syntax error in somebody's report.
 */
export function omitLiterals(text, values) {
    let out = text;
    for (const value of values) {
        if (value.length < SHORTEST_OMIT)
            continue;
        out = out.replace(new RegExp(escapeForRegExp(value), "g"), OMITTED);
    }
    return out;
}
