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
//      4 the command exists but could not do it · 5 waiting on the person's agreement ·
//      130 cancelled.
//    ⚠ 4 IS "COULD NOT", NOT "NOT BUILT". This block used to say "the command exists but is not
//      built", which is not what any command means by it — "no such path", "that is a file", "a
//      folder cannot go inside itself" are all 4. `NotBuiltYetError` shares the number and carries
//      "do not retry"; nothing collides today because nothing is announced-and-unfinished, and if
//      that list is ever repopulated the unfinished case needs a number of its own
//      (2026-08-23).
//
// ⛔ `run` RETURNS A CODE AND NEVER EXITS. Only the bottom of this file calls process.exit, so the
//    whole command surface can be driven from a test without ending the test runner.

import { parseArgs } from "./args.ts";
import { NmtsError, NotBuiltYetError, renderError, UNKNOWN_FAILURE_EXIT } from "./errors.ts";
import { helpText } from "./help.ts";
import { BINARY_NAME, VERSION } from "./product.ts";

/**
 * Commands the help text announces but this version cannot run.
 *
 * ⛔ ANNOUNCED-AND-UNFINISHED IS NOT THE SAME AS UNKNOWN, and an agent needs to tell them apart:
 *    unknown means "you guessed the name wrong, try again", unfinished means "stop, this will not
 *    work however you spell it". They get different exit codes for exactly that reason.
 *
 * ⛔ EMPTY IS THE GOAL, NOT AN OVERSIGHT. Everything help names, this version runs.
 */
export const NOT_BUILT_YET: readonly string[] = [];

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

  // ⛔ EVERY COMMAND IS LOADED ONLY WHEN IT IS THE COMMAND. `put` pulls in the storage network's
  //    SDK, which is the largest thing this package can load, and importing it at the top of this
  //    file made `nmts --help` pay for it: startup went from 0.13s to 0.20s the day `put` landed.
  //    An agent runs this tool in a loop, so a fixed cost per invocation is paid thousands of
  //    times — and the cost grows with every command added, which is exactly the shape of problem
  //    that is never noticed until it is large. `check:cli-startup` measures it.
  switch (args.command) {
    case "login": {
      const { login } = await import("./commands/login.ts");
      return await login({
        server: args.server,
        network: args.network,
        plain: args.plain,
        env: args.env,
      });
    }
    case "logout": {
      const { logout } = await import("./commands/logout.ts");
      return logout();
    }
    case "whoami": {
      const { whoami } = await import("./commands/whoami.ts");
      return await whoami({ server: args.server, network: args.network });
    }
    case "ls": {
      const { ls } = await import("./commands/ls.ts");
      return await ls({
        server: args.server,
        network: args.network,
        json: args.json,
        all: args.all,
        find: args.find,
        sort: args.sort,
        desc: args.desc,
      });
    }
    case "usage": {
      const { usage } = await import("./commands/usage.ts");
      return await usage({ server: args.server, network: args.network, json: args.json });
    }
    case "balance": {
      const { balance } = await import("./commands/balance.ts");
      return await balance({ server: args.server, network: args.network, json: args.json });
    }
    case "public-code": {
      const { publicCode } = await import("./commands/public-code.ts");
      return await publicCode({
        server: args.server,
        network: args.network,
        publish: args.publish,
        json: args.json,
      });
    }
    case "wallet": {
      const { wallet } = await import("./commands/wallet.ts");
      return await wallet(args.operands[0], {
        server: args.server,
        network: args.network,
        json: args.json,
      });
    }
    case "expiring": {
      const { expiring } = await import("./commands/expiring.ts");
      return await expiring({ server: args.server, network: args.network, json: args.json });
    }
    case "get": {
      const { get } = await import("./commands/get.ts");
      return await get(args.operands[0], {
        server: args.server,
        network: args.network,
        out: args.out,
        force: args.force,
        json: args.json,
      });
    }
    case "put": {
      const { put } = await import("./commands/put.ts");
      return await put(args.operands[0], {
        server: args.server,
        network: args.network,
        name: args.name,
        to: args.to,
        dryRun: args.dryRun,
        partSize: args.partSize,
        json: args.json,
      });
    }
    case "push": {
      const { push } = await import("./commands/push.ts");
      return await push(args.operands[0], {
        server: args.server,
        network: args.network,
        to: args.to,
        dryRun: args.dryRun,
        hidden: args.hidden,
        partSize: args.partSize,
        json: args.json,
      });
    }
    case "rm": {
      const { rm } = await import("./commands/trash.ts");
      return await rm(args.operands, { server: args.server, network: args.network, json: args.json });
    }
    case "restore": {
      const { restore } = await import("./commands/trash.ts");
      return await restore(args.operands, { server: args.server, network: args.network, json: args.json });
    }
    case "sweep": {
      const { sweep } = await import("./commands/sweep.ts");
      return await sweep({
        server: args.server,
        network: args.network,
        json: args.json,
        yes: args.yes,
      });
    }
    case "rebuild": {
      const { rebuild } = await import("./commands/rebuild.ts");
      return await rebuild({
        server: args.server,
        network: args.network,
        json: args.json,
        yes: args.yes,
        force: args.force,
      });
    }
    case "listfile": {
      const { listfile } = await import("./commands/listfile.ts");
      return await listfile({ out: args.out, force: args.force });
    }
    case "pull": {
      const { pull } = await import("./commands/pull.ts");
      return await pull(args.operands[0], {
        server: args.server,
        network: args.network,
        out: args.out,
        force: args.force,
        json: args.json,
      });
    }
    case "mkdir": {
      const { mkdir } = await import("./commands/organise.ts");
      return await mkdir(args.operands[0], { server: args.server, network: args.network, json: args.json });
    }
    case "mv": {
      const { mv } = await import("./commands/organise.ts");
      return await mv(args.operands, {
        server: args.server,
        network: args.network,
        json: args.json,
      });
    }
    case "rename": {
      const { rename } = await import("./commands/organise.ts");
      return await rename(args.operands[0], args.operands[1], {
        server: args.server,
        network: args.network,
        json: args.json,
      });
    }
    case "star": {
      const { star } = await import("./commands/marks.ts");
      return await star(args.operands, { server: args.server, network: args.network, json: args.json });
    }
    case "unstar": {
      const { unstar } = await import("./commands/marks.ts");
      return await unstar(args.operands, { server: args.server, network: args.network, json: args.json });
    }
    case "pin": {
      const { pin } = await import("./commands/marks.ts");
      return await pin(args.operands, { server: args.server, network: args.network, json: args.json });
    }
    case "unpin": {
      const { unpin } = await import("./commands/marks.ts");
      return await unpin(args.operands, { server: args.server, network: args.network, json: args.json });
    }
    case "label": {
      const { label } = await import("./commands/marks.ts");
      return await label(args.operands[0], args.operands.slice(1), {
        server: args.server,
        network: args.network,
        json: args.json,
      });
    }
    case "unlabel": {
      const { unlabel } = await import("./commands/marks.ts");
      return await unlabel(args.operands[0], args.operands.slice(1), {
        server: args.server,
        network: args.network,
        json: args.json,
      });
    }
    case "share": {
      const { share } = await import("./commands/share.ts");
      return await share(args.operands[0], args.operands[1], {
        server: args.server,
        network: args.network,
        json: args.json,
      });
    }
    case "shares": {
      const { shares } = await import("./commands/share.ts");
      return await shares({ server: args.server, network: args.network, json: args.json });
    }
    case "unshare": {
      const { unshare } = await import("./commands/share.ts");
      return await unshare(args.operands[0], {
        server: args.server,
        network: args.network,
        json: args.json,
      });
    }
    case "receive": {
      const { receive } = await import("./commands/receive.ts");
      return await receive(args.operands[0], {
        server: args.server,
        network: args.network,
        out: args.out,
        force: args.force,
        json: args.json,
      });
    }
    case "env": {
      const { env } = await import("./commands/env.ts");
      return env({ json: args.json });
    }
    case "consent": {
      const { consent } = await import("./commands/consent.ts");
      return consent(args.operands[0], args.operands[1], { json: args.json });
    }
    case "verify": {
      const { verify } = await import("./commands/verify.ts");
      return await verify({ server: args.server, json: args.json, status: args.status });
    }
    case "recovery": {
      const { recovery } = await import("./commands/recovery.ts");
      return await recovery({ out: args.out, force: args.force, json: args.json });
    }
    case "mcp": {
      const { mcp } = await import("./commands/mcp.ts");
      return await mcp({ server: args.server, network: args.network, out: args.out });
    }
    default:
      if (NOT_BUILT_YET.includes(args.command)) {
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

/**
 * Stop a closed pipe from becoming a crash.
 *
 * ⛔ `nmts ls | head` IS AN ORDINARY THING TO DO, and without this it prints a ten-line stack
 *    trace instead of the answer. `head` closes the pipe once it has its lines; the next write
 *    raises EPIPE, and Node turns an unhandled stream error into a fatal one. Every shell tool is
 *    expected to end quietly there — that is what SIGPIPE does for programs that do not intercept
 *    it — and an agent piping this into anything would otherwise read a crash and conclude the
 *    tool is broken.
 *
 * ⚠ ONLY EPIPE. A write that fails for any other reason is still a real failure and still throws;
 *   swallowing all stream errors would hide a full disk behind silence.
 */
function endQuietlyOnClosedPipe(): void {
  for (const stream of [process.stdout, process.stderr]) {
    stream.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EPIPE") {
        process.exitCode = 0;
        return;
      }
      throw error;
    });
  }
}

async function main(): Promise<void> {
  endQuietlyOnClosedPipe();
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
