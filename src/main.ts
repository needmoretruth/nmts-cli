#!/usr/bin/env node
// nmts — entry point.
//
// Copyright 2026 needmoretruth
//
// Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file
// except in compliance with the License. You may obtain a copy of the License in the LICENSE
// file, or at <http://www.apache.org/licenses/LICENSE-2.0>.
//
// Unless required by applicable law or agreed to in writing, software distributed under the
// License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific language governing permissions
// and limitations under the License.
//
// Other terms can be asked for — see LICENSING.md.
//
// ⛔ EVERY EXIT GOES THROUGH ONE PLACE. A tool an agent drives is read by its exit code far more
//    often than by its output, so the codes are fixed and documented:
//      0 done · 1 something went wrong · 2 the command line was wrong · 3 not signed in ·
//      4 the command exists but could not do it · 5 waiting on the person's agreement ·
//      130 cancelled.
//    ⚠ 4 IS "COULD NOT", NOT "NOT BUILT" — "no such path", "that is a file" are 4;
//      `NotBuiltYetError` shares the number and carries "do not retry" (2026-08-23).
//
// ⛔ `run` RETURNS A CODE AND NEVER EXITS. Only the bottom of this file calls process.exit, so the
//    whole command surface can be driven from a test without ending the test runner.

import { parseArgs } from "./args.ts";
import { NmtsError, NotBuiltYetError, renderError } from "./errors.ts";
import { endQuietlyOnClosedPipe, exitCodeFor, invokedDirectly, noteUpdateAfter } from "./exit.ts";
import { printHelp } from "./help.ts";
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
    return await printHelp(args, (text) => process.stdout.write(text));
  }

  // ⛔ A MODE THAT STOPPED ANNOUNCING ITSELF IS ONE PEOPLE FORGET THEY TURNED ON, and this one
  //    decides whether anybody is asked before money is spent. So it is said on EVERY run, to
  //    stderr — stdout belongs to whatever is reading this tool's output.
  //    ⚠ `mode` itself is exempt: the command that prints the setting does not need it twice.
  if (args.command !== "mode") {
    const { announcement, currentMode } = await import("./autonomy.ts");
    const line = announcement(currentMode());
    if (line !== null) process.stderr.write(`${line}\n`);
  }

  // ⛔ EVERY COMMAND IS LOADED ONLY WHEN IT IS THE COMMAND. `put` pulls in the storage network's
  //    SDK, which is the largest thing this package can load, and importing it at the top of this
  //    file made `nmts --help` pay for it: startup went from 0.13s to 0.20s the day `put` landed.
  //    An agent runs this tool in a loop, so a fixed cost per invocation is paid thousands of
  //    times. `check:cli-startup` measures it.
  // ⛔ THE TIER GATE, BEFORE ANY COMMAND LOADS (`risk.ts` · `gate.ts`): asked or refused by the
  //    act's tier and this machine's mode, the same way for every command.
  await (await import("./risk.ts")).gateArgs(args);

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
      return await whoami({
        server: args.server,
        network: args.network,
        reveal: args.reveal,
        json: args.json,
      });
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
        server: args.server, network: args.network, json: args.json, qr: args.qr,
        rest: args.operands.slice(1), yes: args.yes, dryRun: args.dryRun, feeCap: args.feeCap,
        to: args.to, venue: args.venue, slippageBps: args.slippageBps, acceptExtremes: args.acceptExtremes, size: args.size, epochs: args.epochs,
      });
    }
    case "expiring": {
      const { expiring } = await import("./commands/expiring.ts");
      return await expiring({ server: args.server, network: args.network, json: args.json });
    }
    case "losses": {
      const { losses } = await import("./commands/losses.ts");
      return await losses({
        server: args.server,
        network: args.network,
        json: args.json,
        recheck: args.recheck,
        dismiss: args.dismiss,
      });
    }
    case "extend": {
      const { extend } = await import("./commands/extend.ts");
      return await extend(args.operands[0], {
        server: args.server,
        network: args.network,
        epochs: args.epochs,
        dryRun: args.dryRun,
        yes: args.yes,
        json: args.json,
      });
    }
    case "create": {
      const { create } = await import("./commands/create.ts");
      return await create({
        server: args.server,
        network: args.network,
        out: args.out,
        acceptTerms: args.acceptTerms,
        acceptPrivacy: args.acceptPrivacy,
        json: args.json,
      });
    }
    case "trial": {
      const { trial } = await import("./commands/trial.ts");
      return await trial(args.operands[0], {
        server: args.server,
        network: args.network,
        json: args.json,
      });
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
        onCollision: args.onCollision,
        pay: args.pay,
        epochs: args.epochs,
        storage: args.storage,
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
        onCollision: args.onCollision,
        pay: args.pay,
        epochs: args.epochs,
        storage: args.storage,
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
      return await sweep({ server: args.server, network: args.network, json: args.json, yes: args.yes });
    }
    case "key": {
      const { key } = await import("./commands/key.ts");
      return await key(args.operands[0], args);
    }
    case "devices": {
      const { devices } = await import("./commands/devices.ts");
      return await devices({ server: args.server, json: args.json, signOut: args.signOut, yes: args.yes });
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
    case "padding": {
      const { padding } = await import("./commands/padding.ts");
      return await padding(args.operands[0], {
        server: args.server,
        network: args.network,
        json: args.json,
      });
    }
    case "rollback": {
      const { rollback } = await import("./commands/rollback.ts");
      return await rollback({ server: args.server, network: args.network, json: args.json, yes: args.yes });
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
    case "star":
    case "unstar":
    case "pin":
    case "unpin":
    case "label":
    case "unlabel": {
      const { runMarks } = await import("./commands/marks-dispatch.ts");
      return await runMarks(args.command, args);
    }
    case "share":
    case "shares":
    case "unshare":
    case "receive": {
      const { runShare } = await import("./commands/share-dispatch.ts");
      return await runShare(args.command, args);
    }
    case "support": {
      // ⚠ Options passed whole, as `runSettings` below takes them: this one reads ten of them.
      const { support } = await import("./commands/support.ts");
      return await support(args.operands[0], args.operands.slice(1), args);
    }
    case "notices":
    case "erase":
      return await (await import("./commands/erase.ts")).erase(args.operands, { server: args.server, network: args.network, json: args.json, releaseStorage: args.releaseStorage, yes: args.yes });
    case "tip":
      return await (await import("./commands/tip.ts")).tip(args.operands[0], { server: args.server, network: args.network, json: args.json, yes: args.yes });
    case "delete-account":
      return await (await import("./commands/delete-account.ts")).deleteAccount({ server: args.server, yes: args.yes });
    case "accept-terms":
      return await (await import("./commands/accept-terms.ts")).acceptTerms({ server: args.server, terms: args.acceptTerms, privacy: args.acceptPrivacy });
    case "terms":
    case "privacy": {
      const { runDocuments } = await import("./commands/documents.ts");
      return await runDocuments(args.command, { ...args, id: args.operands[0] });
    }
    case "env": {
      const { env } = await import("./commands/env.ts");
      return env({ json: args.json });
    }
    case "consent":
    case "unlock":
    case "lock":
    case "mode":
    case "on-collision": {
      const { runSettings } = await import("./commands/settings.ts");
      return runSettings(args.command, args);
    }
    case "verify": {
      const { verify } = await import("./commands/verify.ts");
      return await verify({ server: args.server, json: args.json, status: args.status });
    }
    case "recovery":
    case "recovery-list":
    case "kit": {
      const { runRecovery } = await import("./commands/recovery-dispatch.ts");
      return await runRecovery(args.command, args);
    }
    case "update": {
      const { update } = await import("./commands/update.ts");
      return await update({ json: args.json, dryRun: args.dryRun });
    }
    case "mcp": {
      const { mcp } = await import("./commands/mcp.ts");
      return await mcp({ server: args.server, network: args.network, out: args.out });
    }
    case "s3": {
      const { s3 } = await import("./commands/s3.ts");
      return await s3({ server: args.server, network: args.network, port: args.port, json: args.json });
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

async function main(): Promise<void> {
  endQuietlyOnClosedPipe();
  const argv = process.argv.slice(2);
  const started = Date.now();
  let failed: string | null = null;
  try {
    process.exitCode = await run(argv);
  } catch (error) {
    process.stderr.write(`${renderError(error, BINARY_NAME)}\n`);
    process.exitCode = exitCodeFor(error);
    failed = error instanceof Error ? error.message : String(error);
  }
  // ⛔ LOADED AFTER THE COMMAND, LIKE EVERY COMMAND ABOVE: the run log's chain reaches the
  //    credentials module and `--help` must not pay for it first (`check:cli-startup`). It is
  //    outside `run` because the tests drive that directly, and it cannot throw.
  const { noteFailure, recordRun } = await import("./run-log.ts");
  if (failed !== null) noteFailure(failed);
  recordRun(argv, typeof process.exitCode === "number" ? process.exitCode : 0, Date.now() - started);
  await noteUpdateAfter(argv, VERSION);
}

if (invokedDirectly(import.meta.filename)) {
  await main();
}
