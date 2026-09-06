// `nmts push <directory> --pay wallet` — the wallet rail of `push`: each file priced, agreed to and
// signed for on its own by `put-wallet.ts`, stopping at the first failure as the credit rail does.
//
// ⛔ SPLIT OUT OF `push.ts` FOR THE LENGTH GATE, and along the one seam that was already there:
//    `push.ts` decides WHICH files go and where; this decides how the wallet pays for each.
import { loadCrypto } from "../crypto.js";
import { NmtsError } from "../errors.js";
import { resolveNetwork } from "../network.js";
import { Progress, silentSink, stderrSink } from "../progress.js";
import { folderFor } from "./push.js";
/** The wallet rail, one file at a time, stopping at the first failure as the credit rail does. */
export async function pushWithWallet(session, options, run) {
    const { say } = run;
    const { uploadOneWithWallet } = await import("./put-wallet.js");
    const ctx = {
        code: session.code,
        apiKey: session.apiKey,
        server: session.server,
        // ⛔ Narrowed, not asserted: the session carries the name as text and the rail types it.
        network: resolveNetwork(session.server, session.network),
        accountId: session.accountId,
        crypt: await loadCrypto(),
        partSize: run.partSize,
        rule: run.rule,
        onCollision: run.asked,
        settings: run.settings,
        progress: new Progress(options.json === true ? silentSink() : stderrSink(), "uploading"),
        say,
        json: options.json === true,
    };
    if (!options.json) {
        say(`${run.todo.length} file${run.todo.length === 1 ? "" : "s"}  ${run.bytes} bytes  →  paid from the wallet, one file at a time`);
        if (run.already.length > 0)
            say(`  ${run.already.length} already there, not sent again`);
    }
    const uploaded = [];
    try {
        for (const one of run.todo) {
            // ⛔ On a dry run no folder is made either: the destination is resolved only when the
            //    upload is really going to happen, exactly as the credit rail does it.
            const parentId = options.dryRun === true ? null : await folderFor(session, run.folderIds, one.folder);
            if (!options.json)
                say(`  ${one.folder}/${one.name}`);
            const done = await uploadOneWithWallet(ctx, { localPath: one.local, size: one.size, name: one.name, parentId, destination: one.folder }, { ...options, dryRun: options.dryRun === true });
            if (done !== null)
                uploaded.push(`${one.folder}/${done.savedAs}`);
        }
    }
    catch (error) {
        ctx.progress.done();
        const because = error instanceof NmtsError ? error : null;
        throw new NmtsError(error instanceof Error ? error.message : String(error), {
            exitCode: because?.exitCode ?? 1,
            nextStep: uploaded.length === 0
                ? (because?.nextStep ?? "Nothing was uploaded.")
                : `${uploaded.length} file${uploaded.length === 1 ? " is" : "s are"} uploaded and signed for. Running the same command again sends only what is missing.`,
        });
    }
    finally {
        ctx.progress.done();
    }
    if (options.json) {
        say(JSON.stringify({ files: run.found, uploaded: uploaded.length, skipped: run.already.length, bytes: run.bytes, paidFrom: "wallet", dryRun: options.dryRun === true }));
        return 0;
    }
    say(``);
    say(options.dryRun === true ? `  Nothing was signed and nothing was sent.` : `${uploaded.length} sent · ${run.already.length} already there`);
    return 0;
}
