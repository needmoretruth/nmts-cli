// Turning argv into a command and its options.
//
// ⛔ NO SECRET IS EVER AN OPTION. There is no --code and no --api-key, and adding one would undo
//    the reason the credentials module exists: on Linux any process can read another's command
//    line, and the shell records it. A test asserts that no option name here looks like a secret.
//
// ⛔ AN UNKNOWN OPTION IS AN ERROR, NOT A SHRUG. Ignoring it means `--serverr https://…` silently
//    talks to the live server, and an agent retrying with a typo would never learn why.

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
}

/** Every option this tool accepts. Kept as data so a test can assert none of them is a secret. */
export const OPTIONS_TAKING_A_VALUE = ["--server", "--network", "--out"] as const;
export const FLAGS = ["--help", "-h", "--version", "-V", "--json", "--all", "--force"] as const;

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    command: null,
    operands: [],
    help: false,
    version: false,
    json: false,
    all: false,
    force: false,
  };
  let index = 0;
  while (index < argv.length) {
    const token = argv[index];
    if (token === undefined) break;
    index += 1;

    if (token === "--help" || token === "-h") {
      parsed.help = true;
      continue;
    }
    if (token === "--version" || token === "-V") {
      parsed.version = true;
      continue;
    }
    if (token === "--json") {
      parsed.json = true;
      continue;
    }
    if (token === "--all") {
      parsed.all = true;
      continue;
    }
    if (token === "--force") {
      parsed.force = true;
      continue;
    }
    if (token === "--server" || token === "--network" || token === "--out") {
      const value = argv[index];
      if (value === undefined || value.startsWith("-")) {
        throw new NmtsError(`${token} needs a value after it.`, { exitCode: 2 });
      }
      index += 1;
      if (token === "--server") parsed.server = value;
      else if (token === "--network") parsed.network = value;
      else parsed.out = value;
      continue;
    }
    if (token.startsWith("--server=")) {
      parsed.server = token.slice("--server=".length);
      continue;
    }
    if (token.startsWith("--network=")) {
      parsed.network = token.slice("--network=".length);
      continue;
    }
    if (token.startsWith("--out=")) {
      parsed.out = token.slice("--out=".length);
      continue;
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
