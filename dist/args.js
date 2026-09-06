// Turning argv into a command and its options.
//
// ⛔ NO SECRET IS EVER AN OPTION. There is no --code and no --api-key: on Linux any process can read
//    another's command line, and the shell records it. A test asserts no option name looks like one.
//
// ⛔ AN UNKNOWN OPTION IS AN ERROR, NOT A SHRUG: `--serverr` must not silently talk to the live server.
//
// ⛔ THE OPTIONS ARE A TABLE, NOT A LADDER OF `if`s: the tables below are the only place an option
//    is spelled, so it cannot exist as `--x value` and not as `--x=value`.
import { NmtsError } from "./errors.js";
/** Which field a value-taking option fills. */
const VALUE_OPTIONS = {
    "--server": "server",
    "--network": "network",
    "--out": "out",
    "--name": "name",
    "--to": "to",
    "--part-size": "partSize",
    "--on-collision": "onCollision",
    "--find": "find",
    "--sort": "sort",
    "--epochs": "epochs",
    "--pay": "pay",
    "--storage": "storage",
    "--days": "days",
    "--until": "until",
    "--scope": "scope",
    "--scopes": "scopes",
    "--cap-wal": "capWal",
    "--cap-sui": "capSui",
    "--fee-cap": "feeCap",
    "--venue": "venue",
    "--slippage-bps": "slippageBps",
    "--port": "port",
    "--accept-terms": "acceptTerms",
    "--accept-privacy": "acceptPrivacy",
    "--recheck": "recheck",
    "--dismiss": "dismiss",
    "--sent": "sent",
    "--reason": "reason",
    "--size": "size",
    "--sign-out": "signOut",
    "--rename": "rename",
    "--category": "category",
    "--sub": "sub",
    "--message": "message",
    "--message-file": "messageFile",
    "--lang": "lang",
};
/**
 * Which field an option that may be given more than once appends to.
 *
 * ⛔ ITS OWN TABLE, so that "repeatable" is a property of the option rather than of the code that
 *    happens to read it. An option in the value table that a caller repeats today keeps only the
 *    last one, silently, which is the wrong answer for a list of values to remove.
 */
const LIST_OPTIONS = {
    "--omit": "omit",
};
/**
 * Which field an option that MAY carry a value fills, with "" for a bare one.
 *
 * ⛔ THE VALUE IS TAKEN ONLY WHEN IT IS A NUMBER. `--attach-log send` must not read `send` as a
 *    count and leave the command line without its action; every value this shape of option takes
 *    is a count, so "is it digits" is the whole question.
 */
const OPTIONAL_VALUE_OPTIONS = {
    "--attach-log": "attachLog",
};
/** Which field a flag sets to true. */
const FLAG_OPTIONS = {
    "--help": "help",
    "-h": "help",
    "--version": "version",
    "-V": "version",
    "--json": "json",
    "--all": "all",
    "--force": "force",
    "--dry-run": "dryRun",
    "--yes": "yes",
    "-y": "yes",
    "--publish": "publish",
    "--plain": "plain",
    "--env": "env",
    "--status": "status",
    "--desc": "desc",
    "--hidden": "hidden",
    "--reveal": "reveal",
    "--release-storage": "releaseStorage",
    "--print": "print",
    "--qr": "qr",
    "--board": "board",
    "--save": "save",
    "--accept-extremes": "acceptExtremes",
};
// ⛔ Derived from the tables, not written again. A hand-kept list is how an option ends up tested
//    for one property and accepted with another. ⚠ Every option that carries a value is in here,
//    whichever table it lives in — the test that refuses a secret-looking option name reads this.
export const OPTIONS_TAKING_A_VALUE = [
    ...Object.keys(VALUE_OPTIONS),
    ...Object.keys(LIST_OPTIONS),
    ...Object.keys(OPTIONAL_VALUE_OPTIONS),
];
export const FLAGS = Object.keys(FLAG_OPTIONS);
function isValueOption(token) {
    return Object.hasOwn(VALUE_OPTIONS, token);
}
function isListOption(token) {
    return Object.hasOwn(LIST_OPTIONS, token);
}
function isOptionalValueOption(token) {
    return Object.hasOwn(OPTIONAL_VALUE_OPTIONS, token);
}
function isFlag(token) {
    return Object.hasOwn(FLAG_OPTIONS, token);
}
/** A whole number and nothing else. What an optional value is allowed to be. */
const DIGITS = /^[0-9]+$/u;
/** Add one more value to a repeatable option's field. */
function append(parsed, field, value) {
    const held = parsed[field];
    parsed[field] = held === undefined ? [value] : [...held, value];
}
/**
 * Every flag starts false. ⛔ THE KEY TYPE IS DERIVED FROM THE TABLE, so a flag added above and
 * forgotten here stops the build — and written out one flag at a time rather than built at run
 * time, because a shape the compiler cannot see would let a new flag arrive as `undefined`.
 */
const FLAG_DEFAULTS = {
    help: false, version: false, json: false, all: false, force: false, dryRun: false, releaseStorage: false,
    yes: false, publish: false, plain: false, env: false, status: false,
    desc: false, hidden: false, reveal: false, print: false, qr: false, board: false,
    save: false, acceptExtremes: false,
};
export function parseArgs(argv) {
    const parsed = { command: null, operands: [], ...FLAG_DEFAULTS };
    let index = 0;
    // ⛔ EVERYTHING AFTER `--` IS A NAME, NOT AN OPTION. Files in a drive are named by people and by
    //    other programs, and a name is allowed to start with a dash. Without this, `nmts rm -h`
    //    printed the help text and EXITED 0 — a silent false success on a deletion, for a path
    //    `nmts ls --json` had just handed the caller (2026-08-23).
    let optionsEnded = false;
    while (index < argv.length) {
        const token = argv[index];
        if (token === undefined)
            break;
        index += 1;
        if (optionsEnded) {
            parsed.operands.push(token);
            continue;
        }
        if (token === "--") {
            optionsEnded = true;
            continue;
        }
        if (isFlag(token)) {
            parsed[FLAG_OPTIONS[token]] = true;
            continue;
        }
        if (isListOption(token)) {
            const value = argv[index];
            if (value === undefined || (value.startsWith("-") && value !== "-")) {
                throw new NmtsError(`${token} needs a value after it.`, { exitCode: 2 });
            }
            index += 1;
            append(parsed, LIST_OPTIONS[token], value);
            continue;
        }
        if (isOptionalValueOption(token)) {
            const value = argv[index];
            if (value !== undefined && DIGITS.test(value)) {
                index += 1;
                parsed[OPTIONAL_VALUE_OPTIONS[token]] = value;
            }
            else {
                parsed[OPTIONAL_VALUE_OPTIONS[token]] = "";
            }
            continue;
        }
        if (isValueOption(token)) {
            const value = argv[index];
            // ⛔ A LONE `-` IS A VALUE, NOT AN OPTION. It is how every tool spells "the standard
            //    streams", and `--out -` is what sends a fetched file to stdout instead of the disk.
            //    The rest of the test is unchanged and still catches `--out --force`, which is a
            //    missing value; this is the same exception the unknown-option check below already
            //    makes for a bare dash.
            if (value === undefined || (value.startsWith("-") && value !== "-")) {
                throw new NmtsError(`${token} needs a value after it.`, { exitCode: 2 });
            }
            index += 1;
            parsed[VALUE_OPTIONS[token]] = value;
            continue;
        }
        const equals = token.indexOf("=");
        if (equals > 0) {
            const head = token.slice(0, equals);
            if (isValueOption(head)) {
                parsed[VALUE_OPTIONS[head]] = token.slice(equals + 1);
                continue;
            }
            if (isListOption(head)) {
                append(parsed, LIST_OPTIONS[head], token.slice(equals + 1));
                continue;
            }
            if (isOptionalValueOption(head)) {
                parsed[OPTIONAL_VALUE_OPTIONS[head]] = token.slice(equals + 1);
                continue;
            }
        }
        if (token.startsWith("-") && token !== "-") {
            throw new NmtsError(`Unknown option: ${token}`, {
                exitCode: 2,
                nextStep: `Run with --help to see the options this version accepts.`,
            });
        }
        if (parsed.command === null)
            parsed.command = token;
        else
            parsed.operands.push(token);
    }
    return parsed;
}
