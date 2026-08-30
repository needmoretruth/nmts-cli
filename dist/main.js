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
//    ⚠ 4 IS "COULD NOT", NOT "NOT BUILT". This block used to say "the command exists but is not
//      built", which is not what any command means by it — "no such path", "that is a file", "a
//      folder cannot go inside itself" are all 4. `NotBuiltYetError` shares the number and carries
//      "do not retry"; nothing collides today because nothing is announced-and-unfinished, and if
//      that list is ever repopulated the unfinished case needs a number of its own
//      (2026-08-23).
//
// ⛔ `run` RETURNS A CODE AND NEVER EXITS. Only the bottom of this file calls process.exit, so the
//    whole command surface can be driven from a test without ending the test runner.
import { parseArgs } from "./args.js";
import { NmtsError, NotBuiltYetError, renderError } from "./errors.js";
import { endQuietlyOnClosedPipe, exitCodeFor, invokedDirectly, noteUpdateAfter } from "./exit.js";
import { helpText } from "./help.js";
import { BINARY_NAME, VERSION } from "./product.js";
/**
 * Commands the help text announces but this version cannot run.
 *
 * ⛔ ANNOUNCED-AND-UNFINISHED IS NOT THE SAME AS UNKNOWN, and an agent needs to tell them apart:
 *    unknown means "you guessed the name wrong, try again", unfinished means "stop, this will not
 *    work however you spell it". They get different exit codes for exactly that reason.
 *
 * ⛔ EMPTY IS THE GOAL, NOT AN OVERSIGHT. Everything help names, this version runs.
 */
export const NOT_BUILT_YET = [];
export async function run(argv) {
    const args = parseArgs(argv);
    if (args.version) {
        process.stdout.write(`${VERSION}\n`);
        return 0;
    }
    if (args.help || args.command === null || args.command === "help") {
        process.stdout.write(helpText(VERSION));
        return 0;
    }
    // ⛔ A MODE THAT STOPPED ANNOUNCING ITSELF IS ONE PEOPLE FORGET THEY TURNED ON, and this one
    //    decides whether anybody is asked before money is spent. So it is said on EVERY run, to
    //    stderr — stdout belongs to whatever is reading this tool's output.
    //    ⚠ `mode` itself is exempt: the command that prints the setting does not need it twice.
    if (args.command !== "mode") {
        const { announcement, currentMode } = await import("./autonomy.js");
        const line = announcement(currentMode());
        if (line !== null)
            process.stderr.write(`${line}\n`);
    }
    // ⛔ EVERY COMMAND IS LOADED ONLY WHEN IT IS THE COMMAND. `put` pulls in the storage network's
    //    SDK, which is the largest thing this package can load, and importing it at the top of this
    //    file made `nmts --help` pay for it: startup went from 0.13s to 0.20s the day `put` landed.
    //    An agent runs this tool in a loop, so a fixed cost per invocation is paid thousands of
    //    times — and the cost grows with every command added, which is exactly the shape of problem
    //    that is never noticed until it is large. `check:cli-startup` measures it.
    switch (args.command) {
        case "login": {
            const { login } = await import("./commands/login.js");
            return await login({
                server: args.server,
                network: args.network,
                plain: args.plain,
                env: args.env,
            });
        }
        case "logout": {
            const { logout } = await import("./commands/logout.js");
            return logout();
        }
        case "whoami": {
            const { whoami } = await import("./commands/whoami.js");
            return await whoami({ server: args.server, network: args.network });
        }
        case "ls": {
            const { ls } = await import("./commands/ls.js");
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
            const { usage } = await import("./commands/usage.js");
            return await usage({ server: args.server, network: args.network, json: args.json });
        }
        case "balance": {
            const { balance } = await import("./commands/balance.js");
            return await balance({ server: args.server, network: args.network, json: args.json });
        }
        case "public-code": {
            const { publicCode } = await import("./commands/public-code.js");
            return await publicCode({
                server: args.server,
                network: args.network,
                publish: args.publish,
                json: args.json,
            });
        }
        case "wallet": {
            const { wallet } = await import("./commands/wallet.js");
            return await wallet(args.operands[0], {
                server: args.server,
                network: args.network,
                json: args.json,
            });
        }
        case "expiring": {
            const { expiring } = await import("./commands/expiring.js");
            return await expiring({ server: args.server, network: args.network, json: args.json });
        }
        case "extend": {
            const { extend } = await import("./commands/extend.js");
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
            const { create } = await import("./commands/create.js");
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
            const { trial } = await import("./commands/trial.js");
            return await trial(args.operands[0], {
                server: args.server,
                network: args.network,
                json: args.json,
            });
        }
        case "get": {
            const { get } = await import("./commands/get.js");
            return await get(args.operands[0], {
                server: args.server,
                network: args.network,
                out: args.out,
                force: args.force,
                json: args.json,
            });
        }
        case "put": {
            const { put } = await import("./commands/put.js");
            return await put(args.operands[0], {
                server: args.server,
                network: args.network,
                name: args.name,
                to: args.to,
                dryRun: args.dryRun,
                partSize: args.partSize,
                onCollision: args.onCollision,
                json: args.json,
            });
        }
        case "push": {
            const { push } = await import("./commands/push.js");
            return await push(args.operands[0], {
                server: args.server,
                network: args.network,
                to: args.to,
                dryRun: args.dryRun,
                hidden: args.hidden,
                partSize: args.partSize,
                onCollision: args.onCollision,
                json: args.json,
            });
        }
        case "rm": {
            const { rm } = await import("./commands/trash.js");
            return await rm(args.operands, { server: args.server, network: args.network, json: args.json });
        }
        case "restore": {
            const { restore } = await import("./commands/trash.js");
            return await restore(args.operands, { server: args.server, network: args.network, json: args.json });
        }
        case "sweep": {
            const { sweep } = await import("./commands/sweep.js");
            return await sweep({
                server: args.server,
                network: args.network,
                json: args.json,
                yes: args.yes,
            });
        }
        case "rebuild": {
            const { rebuild } = await import("./commands/rebuild.js");
            return await rebuild({
                server: args.server,
                network: args.network,
                json: args.json,
                yes: args.yes,
                force: args.force,
            });
        }
        case "listfile": {
            const { listfile } = await import("./commands/listfile.js");
            return await listfile({ out: args.out, force: args.force });
        }
        case "pull": {
            const { pull } = await import("./commands/pull.js");
            return await pull(args.operands[0], {
                server: args.server,
                network: args.network,
                out: args.out,
                force: args.force,
                json: args.json,
            });
        }
        case "mkdir": {
            const { mkdir } = await import("./commands/organise.js");
            return await mkdir(args.operands[0], { server: args.server, network: args.network, json: args.json });
        }
        case "mv": {
            const { mv } = await import("./commands/organise.js");
            return await mv(args.operands, {
                server: args.server,
                network: args.network,
                json: args.json,
            });
        }
        case "rename": {
            const { rename } = await import("./commands/organise.js");
            return await rename(args.operands[0], args.operands[1], {
                server: args.server,
                network: args.network,
                json: args.json,
            });
        }
        case "star": {
            const { star } = await import("./commands/marks.js");
            return await star(args.operands, { server: args.server, network: args.network, json: args.json });
        }
        case "unstar": {
            const { unstar } = await import("./commands/marks.js");
            return await unstar(args.operands, { server: args.server, network: args.network, json: args.json });
        }
        case "pin": {
            const { pin } = await import("./commands/marks.js");
            return await pin(args.operands, { server: args.server, network: args.network, json: args.json });
        }
        case "unpin": {
            const { unpin } = await import("./commands/marks.js");
            return await unpin(args.operands, { server: args.server, network: args.network, json: args.json });
        }
        case "label": {
            const { label } = await import("./commands/marks.js");
            return await label(args.operands[0], args.operands.slice(1), {
                server: args.server,
                network: args.network,
                json: args.json,
            });
        }
        case "unlabel": {
            const { unlabel } = await import("./commands/marks.js");
            return await unlabel(args.operands[0], args.operands.slice(1), {
                server: args.server,
                network: args.network,
                json: args.json,
            });
        }
        case "share": {
            const { share } = await import("./commands/share.js");
            return await share(args.operands[0], args.operands[1], {
                server: args.server,
                network: args.network,
                json: args.json,
            });
        }
        case "shares": {
            const { shares } = await import("./commands/share.js");
            return await shares({ server: args.server, network: args.network, json: args.json });
        }
        case "unshare": {
            const { unshare } = await import("./commands/share.js");
            return await unshare(args.operands[0], {
                server: args.server,
                network: args.network,
                json: args.json,
            });
        }
        case "receive": {
            const { receive } = await import("./commands/receive.js");
            return await receive(args.operands[0], {
                server: args.server,
                network: args.network,
                out: args.out,
                force: args.force,
                json: args.json,
            });
        }
        case "env": {
            const { env } = await import("./commands/env.js");
            return env({ json: args.json });
        }
        case "consent":
        case "mode":
        case "on-collision": {
            const { runSettings } = await import("./commands/settings.js");
            return runSettings(args.command, args);
        }
        case "verify": {
            const { verify } = await import("./commands/verify.js");
            return await verify({ server: args.server, json: args.json, status: args.status });
        }
        case "recovery": {
            const { recovery } = await import("./commands/recovery.js");
            return await recovery({ out: args.out, force: args.force, json: args.json });
        }
        case "recovery-list": {
            const { recoveryList } = await import("./commands/recovery-list.js");
            return await recoveryList({
                server: args.server,
                network: args.network,
                out: args.out,
                force: args.force,
                json: args.json,
            });
        }
        case "kit": {
            const { kit } = await import("./commands/kit.js");
            return await kit({
                server: args.server,
                network: args.network,
                out: args.out,
                force: args.force,
                json: args.json,
            });
        }
        case "update": {
            const { update } = await import("./commands/update.js");
            return await update({ json: args.json, dryRun: args.dryRun });
        }
        case "mcp": {
            const { mcp } = await import("./commands/mcp.js");
            return await mcp({ server: args.server, network: args.network, out: args.out });
        }
        case "s3": {
            const { s3 } = await import("./commands/s3.js");
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
async function main() {
    endQuietlyOnClosedPipe();
    const argv = process.argv.slice(2);
    try {
        process.exitCode = await run(argv);
    }
    catch (error) {
        process.stderr.write(`${renderError(error, BINARY_NAME)}\n`);
        process.exitCode = exitCodeFor(error);
    }
    await noteUpdateAfter(argv, VERSION);
}
if (invokedDirectly(import.meta.filename)) {
    await main();
}
