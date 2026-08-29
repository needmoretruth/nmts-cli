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

import { NmtsError } from "./errors.ts";

export interface ParsedArgs {
  command: string | null;
  /** Positional arguments after the command. */
  operands: string[];
  server?: string;
  network?: string;
  help: boolean;
  version: boolean;
  /** Machine-readable output where a command has one. */
  json: boolean;
  /** Include what is in the trash. */
  all: boolean;
  /** Where to write a fetched file. */
  out?: string;
  /** Replace a file that is already there. */
  force: boolean;
  /** The name an uploaded file gets in the drive. */
  name?: string;
  /** The destination folder for an upload. */
  to?: string;
  /** Say what an upload would cost and stop. */
  dryRun: boolean;
  /** `put`: how much of a file goes into one part. A byte count, optionally with a unit. */
  partSize?: string;
  /** `put`/`push`: what THIS run does about a name already in use. Absent = this machine's setting. */
  onCollision?: string;
  /** Answer yes to a warning this run would otherwise stop on. */
  yes: boolean;
  /** `public-code`: publish this account's public code on the server. Permanent. */
  publish: boolean;
  /** `login`: store the account code unsealed rather than under a passphrase. */
  plain: boolean;
  /** `login`: store nothing; print the environment variable to set. */
  env: boolean;
  /** `verify`: report whether the human check is live and stop, asking for no new code. */
  status: boolean;
  /**
   * `mode`: turn an autonomy mode on.
   *
   * ⛔ Spelled out rather than short. It is the sentence that lets an agent stop asking, and the
   *    length is the point — nobody types it by accident, and anybody reading a script sees it.
   */
  iAcceptTheRisk: boolean;
  /** `ls`: keep only files whose name contains this text, case-insensitively. */
  find?: string;
  /** `ls`: which order to list in — `name`, `size` or `date`. Absent = the path order. */
  sort?: string;
  /** `ls`: reverse whichever order is in effect. */
  desc: boolean;
  /** `push`: include entries whose name begins with a dot. */
  hidden: boolean;
  /** `extend`: how many of the storage network's epochs to add. */
  epochs?: string;
  /** `s3`: which loopback port the gateway listens on. */
  port?: string;
  /**
   * `create`: the version of the Terms of Service a PERSON read and accepts for the new account.
   *
   * ⛔ IT IS A VALUE AND NOT A FLAG, so that what was accepted is on the command line rather than
   *    implied by it. A tool that could accept "whatever is current" would be agreeing on behalf
   *    of somebody who never saw a version number.
   */
  acceptTerms?: string;
  /** `create`: the version of the Privacy Policy accepted in the same act. */
  acceptPrivacy?: string;
}

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
} as const satisfies Record<string, keyof ParsedArgs>;

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
} as const satisfies Record<string, keyof ParsedArgs>;

// ⛔ Derived from the tables, not written again. A hand-kept list is how an option ends up tested
//    for one property and accepted with another.
export const OPTIONS_TAKING_A_VALUE = Object.keys(VALUE_OPTIONS);
export const FLAGS = Object.keys(FLAG_OPTIONS);

function isValueOption(token: string): token is keyof typeof VALUE_OPTIONS {
  return Object.hasOwn(VALUE_OPTIONS, token);
}

function isFlag(token: string): token is keyof typeof FLAG_OPTIONS {
  return Object.hasOwn(FLAG_OPTIONS, token);
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = {
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
  };
  let index = 0;
  // ⛔ EVERYTHING AFTER `--` IS A NAME, NOT AN OPTION. Files in a drive are named by people and by
  //    other programs, and a name is allowed to start with a dash. Without this, `nmts rm -h`
  //    printed the help text and EXITED 0 — a silent false success on a deletion, for a path
  //    `nmts ls --json` had just handed the caller (2026-08-23).
  let optionsEnded = false;
  while (index < argv.length) {
    const token = argv[index];
    if (token === undefined) break;
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
    if (parsed.command === null) parsed.command = token;
    else parsed.operands.push(token);
  }
  return parsed;
}
