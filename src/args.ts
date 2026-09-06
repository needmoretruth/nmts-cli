// Turning argv into a command and its options.
//
// ⛔ NO SECRET IS EVER AN OPTION. There is no --code and no --api-key: on Linux any process can read
//    another's command line, and the shell records it. A test asserts no option name looks like one.
//
// ⛔ AN UNKNOWN OPTION IS AN ERROR, NOT A SHRUG: `--serverr` must not silently talk to the live server.
//
// ⛔ THE OPTIONS ARE A TABLE, NOT A LADDER OF `if`s: the tables below are the only place an option
//    is spelled, so it cannot exist as `--x value` and not as `--x=value`.

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
  /** `ls`: keep only files whose name contains this text, case-insensitively. */
  find?: string;
  /** `ls`: which order to list in — `name`, `size` or `date`. Absent = the path order. */
  sort?: string;
  /** `ls`: reverse whichever order is in effect. */
  desc: boolean;
  /** `push`: include entries whose name begins with a dot. */
  hidden: boolean;
  /** `extend`: how many of the storage network's epochs to add; `put`/`push --pay wallet`: how many to buy. */
  epochs?: string;
  /** `put`/`push`: who pays for the storage — `credits` (the default) or `wallet`. */
  pay?: string;
  /** `put --pay wallet`: `fit`, `whole`, or a held storage resource's object id. */
  storage?: string;
  /**
   * `consent grant wallet`: how long the grant lasts (days, at most 30), or until a date.
   * `key new`: how many days the new API key lasts. The server clamps at its own ceiling.
   */
  days?: string;
  until?: string;
  /** `consent grant wallet`: `storage` or `all`. */
  scope?: string;
  /** `key new`: which permissions the key carries — `read`, `write`, `spend`, comma-separated. */
  scopes?: string;
  /** `consent grant wallet`: ceilings in coins. */
  capWal?: string;
  capSui?: string;
  /** `wallet send` · `wallet swap`: a ceiling on the chain fee, in SUI. */
  feeCap?: string;
  /** `wallet swap`: which venue, deepbook or bluefin. Without it both are quoted and the run stops. */
  venue?: string;
  /** `wallet swap`: the slippage allowance in whole bps (1 bps = 0.01%). */
  slippageBps?: string;
  /** `wallet swap`: a person's say past the extremes gate. Refused while a mode is on. */
  acceptExtremes: boolean;
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
  /** `losses`: ask the chain about ONE listed storage object now, instead of listing. */
  recheck?: string;
  /**
   * `losses`: take ONE line off this account's own drive, instead of listing. ⛔ A VALUE AND NOT A
   * FLAG, so the line put down is named on the command line: a person reads one and puts it down.
   */
  dismiss?: string;
  /** `shares`: who ONE file was shared with, instead of what was shared with this account. */
  sent?: string;
  /** ultra-high acts under skip-permissions: why this is right to do now. Kept in the run log. */
  reason?: string;
  releaseStorage: boolean;
  size?: string;
  /** `devices`: sign ONE device out by id, or `all` — a person's act, proved by the account code. */
  signOut?: string;
  /**
   * `label`: the label to rename. The NEW name follows as the operand.
   *
   * ⛔ ONE VALUE, NOT TWO, because the table above gives every option exactly one — and a second
   *    spelling of "how many values does this take" is how an option ends up parsed one way and
   *    tested another. What a person types is still `label --rename <old> <new>`: the new name is
   *    read from the operands, which is where `label <name> <files>` already reads a name from.
   */
  rename?: string;
  /** `support send`: what the report is about, and optionally which part of that. */
  category?: string;
  sub?: string;
  /** `support`: the message itself, or the file holding it. */
  message?: string;
  messageFile?: string;
  /**
   * `support send`: attach the run log, and how many runs of it.
   *
   * ⛔ THE EMPTY STRING IS "GIVEN WITH NO NUMBER", which is different from absent. A boolean
   *    beside a count would be two fields answering one question, and the pair can disagree.
   */
  attachLog?: string;
  /**
   * `support`: values that must not travel, replaced wherever they appear.
   *
   * ⛔ THE ONLY REPEATABLE OPTION, and it is repeatable because what it names is one value at a
   *    time. A comma-separated list would make a comma impossible to omit.
   */
  omit?: string[];
  /**
   * `whoami`: print the account code itself.
   *
   * ⛔ A FLAG AND NOT A VALUE — it names no secret, it asks for the one this machine already
   *    holds. The option table is checked for names that look like credentials; this one carries
   *    nothing and says what it does.
   */
  reveal: boolean;
  /**
   * `key new`: put the new key on the screen once, as well as storing it. A flag and not a value
   * for the reason above: it names no secret, it asks for the one this run was just handed.
   */
  print: boolean;
  /** `nmts wallet address --qr` — the address as a QR code in the terminal as well. */
  qr: boolean;
  /** `terms`/`privacy`: which language to fetch — `en` or `ko`. Absent = English. */
  lang?: string;
  /** `terms`: the message board's terms rather than the service's. */
  board: boolean;
  /**
   * `notices`/`terms`/`privacy`: keep the document as a file instead of printing it.
   *
   * ⛔ A FLAG, AND THE NOTICE'S ID IS STILL THE OPERAND. `notices --save <id>` reads exactly like
   *    `notices <id>`, which is the point: one way to name a notice, whichever of the two things
   *    is being done with it. The file's NAME is never an option — it is the server's, so that a
   *    copy kept here and a copy kept from the browser are the same file.
   */
  save: boolean;
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
} as const satisfies Record<string, keyof ParsedArgs>;

/**
 * Which field an option that may be given more than once appends to.
 *
 * ⛔ ITS OWN TABLE, so that "repeatable" is a property of the option rather than of the code that
 *    happens to read it. An option in the value table that a caller repeats today keeps only the
 *    last one, silently, which is the wrong answer for a list of values to remove.
 */
const LIST_OPTIONS = {
  "--omit": "omit",
} as const satisfies Record<string, keyof ParsedArgs>;

/**
 * Which field an option that MAY carry a value fills, with "" for a bare one.
 *
 * ⛔ THE VALUE IS TAKEN ONLY WHEN IT IS A NUMBER. `--attach-log send` must not read `send` as a
 *    count and leave the command line without its action; every value this shape of option takes
 *    is a count, so "is it digits" is the whole question.
 */
const OPTIONAL_VALUE_OPTIONS = {
  "--attach-log": "attachLog",
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
  "--desc": "desc",
  "--hidden": "hidden",
  "--reveal": "reveal",
  "--release-storage": "releaseStorage",
  "--print": "print",
  "--qr": "qr",
  "--board": "board",
  "--save": "save",
  "--accept-extremes": "acceptExtremes",
} as const satisfies Record<string, keyof ParsedArgs>;

// ⛔ Derived from the tables, not written again. A hand-kept list is how an option ends up tested
//    for one property and accepted with another. ⚠ Every option that carries a value is in here,
//    whichever table it lives in — the test that refuses a secret-looking option name reads this.
export const OPTIONS_TAKING_A_VALUE = [
  ...Object.keys(VALUE_OPTIONS),
  ...Object.keys(LIST_OPTIONS),
  ...Object.keys(OPTIONAL_VALUE_OPTIONS),
];
export const FLAGS = Object.keys(FLAG_OPTIONS);

function isValueOption(token: string): token is keyof typeof VALUE_OPTIONS {
  return Object.hasOwn(VALUE_OPTIONS, token);
}

function isListOption(token: string): token is keyof typeof LIST_OPTIONS {
  return Object.hasOwn(LIST_OPTIONS, token);
}

function isOptionalValueOption(token: string): token is keyof typeof OPTIONAL_VALUE_OPTIONS {
  return Object.hasOwn(OPTIONAL_VALUE_OPTIONS, token);
}

function isFlag(token: string): token is keyof typeof FLAG_OPTIONS {
  return Object.hasOwn(FLAG_OPTIONS, token);
}

/** A whole number and nothing else. What an optional value is allowed to be. */
const DIGITS = /^[0-9]+$/u;

/** Add one more value to a repeatable option's field. */
function append(
  parsed: ParsedArgs,
  field: (typeof LIST_OPTIONS)[keyof typeof LIST_OPTIONS],
  value: string,
): void {
  const held = parsed[field];
  parsed[field] = held === undefined ? [value] : [...held, value];
}

/**
 * Every flag starts false. ⛔ THE KEY TYPE IS DERIVED FROM THE TABLE, so a flag added above and
 * forgotten here stops the build — and written out one flag at a time rather than built at run
 * time, because a shape the compiler cannot see would let a new flag arrive as `undefined`.
 */
const FLAG_DEFAULTS: Record<(typeof FLAG_OPTIONS)[keyof typeof FLAG_OPTIONS], boolean> = {
  help: false, version: false, json: false, all: false, force: false, dryRun: false, releaseStorage: false,
  yes: false, publish: false, plain: false, env: false, status: false,
  desc: false, hidden: false, reveal: false, print: false, qr: false, board: false,
  save: false, acceptExtremes: false,
};

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = { command: null, operands: [], ...FLAG_DEFAULTS };
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
      } else {
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
    if (parsed.command === null) parsed.command = token;
    else parsed.operands.push(token);
  }
  return parsed;
}
