// Turning argv into a command and its options.
//
// ⛔ NO SECRET IS EVER AN OPTION. There is no --code and no --api-key, and adding one would undo
//    the reason the credentials module exists: on Linux any process can read another's command
//    line, and the shell records it. A test asserts that no option name here looks like a secret.
//
// ⛔ AN UNKNOWN OPTION IS AN ERROR, NOT A SHRUG. Ignoring it means `--serverr https://…` silently
//    talks to the live server, and an agent retrying with a typo would never learn why.
//
// ⛔ THE OPTIONS ARE A TABLE, NOT A LADDER OF `if`s. Every option used to be written three times —
//    once in the list a test reads, once as `--x value` and once as `--x=value` — and adding one
//    meant remembering all three. Now the table below is the only place, so an option cannot exist
//    in one spelling and not the other.
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
    "--port": "port",
    "--accept-terms": "acceptTerms",
    "--accept-privacy": "acceptPrivacy",
    "--recheck": "recheck",
    "--dismiss": "dismiss",
    "--sent": "sent",
    "--rename": "rename",
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
    "--i-accept-the-risk": "iAcceptTheRisk",
    "--desc": "desc",
    "--hidden": "hidden",
    "--reveal": "reveal",
};
// ⛔ Derived from the tables, not written again. A hand-kept list is how an option ends up tested
//    for one property and accepted with another.
export const OPTIONS_TAKING_A_VALUE = Object.keys(VALUE_OPTIONS);
export const FLAGS = Object.keys(FLAG_OPTIONS);
function isValueOption(token) {
    return Object.hasOwn(VALUE_OPTIONS, token);
}
function isFlag(token) {
    return Object.hasOwn(FLAG_OPTIONS, token);
}
export function parseArgs(argv) {
    const parsed = {
        command: null,
        operands: [],
        help: false,
        version: false,
        json: false,
        all: false,
        force: false,
        publish: false,
        dryRun: false,
        yes: false,
        plain: false,
        env: false,
        status: false,
        iAcceptTheRisk: false,
        desc: false,
        hidden: false,
        reveal: false,
    };
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
