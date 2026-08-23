#!/usr/bin/env node
// nmts — entry point.
//
// Copyright (C) 2026 needmoretruth
//
// This program is free software: you can redistribute it and/or modify it under the terms
// of the GNU Affero General Public License, version 3 only, as published by the Free
// Software Foundation. It is distributed WITHOUT ANY WARRANTY; without even the implied
// warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the LICENSE file,
// or <https://www.gnu.org/licenses/agpl-3.0.html>.
//
// A separate licence can be arranged — see LICENSING.md.
//
// ⛔ EVERY EXIT GOES THROUGH ONE PLACE. A tool an agent drives is read by its exit code far more
//    often than by its output, so the codes are fixed and documented:
//      0 done · 1 something went wrong · 2 the command line was wrong · 3 not signed in ·
//      4 the command exists but is not built · 130 cancelled.
//
// ⛔ `run` RETURNS A CODE AND NEVER EXITS. Only the bottom of this file calls process.exit, so the
//    whole command surface can be driven from a test without ending the test runner.

import { parseArgs } from "./args.ts";
import { NmtsError, NotBuiltYetError, renderError, UNKNOWN_FAILURE_EXIT } from "./errors.ts";
import { helpText } from "./help.ts";
import { BINARY_NAME } from "./product.ts";
import { login } from "./commands/login.ts";
import { logout } from "./commands/logout.ts";
import { whoami } from "./commands/whoami.ts";

/** Kept here, not read from package.json: the published build has no package.json beside it. */
export const VERSION = "0.0.0";

/**
 * Commands this version announces but has not built.
 *
 * ⛔ ANNOUNCED AND UNFINISHED IS NOT THE SAME AS UNKNOWN, and an agent needs to tell them apart:
 *    unknown means "you guessed the name wrong, try again", unfinished means "stop, this will not
 *    work however you spell it". They get different exit codes for exactly that reason.
 */
export const NOT_BUILT_YET = ["ls", "put", "get"] as const;

export async function run(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);

  if (args.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (args.help || args.command === null || args.command === "help") {
    process.stdout.write(helpText(VERSION));
    return 0;
  }

  switch (args.command) {
    case "login":
      return await login({ server: args.server, network: args.network });
    case "logout":
      return logout();
    case "whoami":
      return await whoami({ server: args.server, network: args.network });
    default:
      if ((NOT_BUILT_YET as readonly string[]).includes(args.command)) {
        throw new NotBuiltYetError(`\`${args.command}\``);
      }
      throw new NmtsError(`Unknown command: ${args.command}`, {
        exitCode: 2,
        nextStep: `Run \`${BINARY_NAME} --help\` to see what this version does.`,
      });
  }
}

/** The exit code a failure asks for, or the generic one. */
export function exitCodeFor(error: unknown): number {
  if (error instanceof NmtsError) return error.exitCode;
  return UNKNOWN_FAILURE_EXIT;
}

async function main(): Promise<void> {
  try {
    process.exitCode = await run(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${renderError(error, BINARY_NAME)}\n`);
    process.exitCode = exitCodeFor(error);
  }
}

// Run only when this file is the program, so importing it from a test does nothing.
if (process.argv[1] !== undefined && import.meta.filename === process.argv[1]) {
  await main();
}
