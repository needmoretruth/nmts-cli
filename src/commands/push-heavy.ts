// `nmts push <directory> --tier heavy` — a whole directory into NMTS Heavy, keeping its shape.
//
// ⛔ ONE ORDER FOR THE DIRECTORY, not one per file: fifty small files are one order and — when the
//    wallet pays — one signature. An order holds at most 256 parts, so a larger tree is sent as
//    several orders one after another, each committed before the next begins.
//
// ⛔ WHAT IS ALREADY THERE IS SKIPPED, as on Standard, which is what makes running it again safe.
//    And it stops at the first failure, saying what is already uploaded — the rule `push.ts` gives.

import { parseAsked } from "../collision.ts";
import { loadCrypto } from "../crypto.ts";
import { NmtsError } from "../errors.ts";
import { planHeavyFile, type HeavyFile } from "../heavy-upload.ts";
import { paddingRuleOf, readFileList } from "../manifest.ts";
import { resolveNetwork } from "../network.ts";
import { Progress, silentSink } from "../progress.ts";
import { stderrSink } from "../progress-node.ts";
import { openSession } from "../session.ts";
import { HEAVY_MAX_SLOTS } from "../shared/lib/heavy/order-runner.ts";
import { fileSource } from "../upload-file-node.ts";
import { heavyDryRun, heavyPayerOf, recordHeavy, refuseHeavyClashes, runHeavy } from "./heavy-run.ts";
import { payerAddressOf, sayDryRun } from "./put-heavy.ts";
import { folderFor, type PushOptions } from "./push.ts";
import { localTree, splitAlready, type PlannedFile } from "./push-tree.ts";

/** Cut the files into runs of at most one order's parts, in order. */
export function batchesOf<T extends { size: number }>(files: readonly T[], partsOf: (one: T) => number): T[][] {
  const out: T[][] = [];
  let current: T[] = [];
  let slots = 0;
  for (const one of files) {
    const parts = partsOf(one);
    if (current.length > 0 && slots + parts > HEAVY_MAX_SLOTS) {
      out.push(current);
      current = [];
      slots = 0;
    }
    current.push(one);
    slots += parts;
  }
  if (current.length > 0) out.push(current);
  return out;
}

export async function pushHeavy(target: string, options: PushOptions): Promise<number> {
  const say = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const payer = heavyPayerOf(options.pay);
  refuseHeavyClashes(options, payer);
  const { root, found } = localTree(target, options.to, options.hidden === true);
  if (found.length === 0) {
    if (options.json) {
      say(JSON.stringify({ files: 0, uploaded: 0, skipped: 0 }));
      return 0;
    }
    say(`${root} holds no files to send.`);
    return 0;
  }
  const session = await openSession({ server: options.server, network: options.network });
  const network = resolveNetwork(session.server, session.network);
  const asked = parseAsked(options.onCollision);
  const list = await readFileList(session.server, session.apiKey, session.code, session.accountId);
  const rule = paddingRuleOf(list.manifest?.settings);
  const { folderIds, already, todo } = splitAlready(list.manifest?.entries ?? [], found);
  const heavyFile = (one: PlannedFile, parentId: string | null): HeavyFile => ({
    source: fileSource(one.local, one.size),
    name: one.name,
    parentId,
    destination: one.folder,
  });

  if (options.dryRun === true) {
    const facts = {
      files: found.length,
      toSend: todo.length,
      skipped: already.length,
      ...(todo.length === 0 ? {} : heavyDryRun(todo.map((one) => heavyFile(one, null)), rule, payer)),
      ...(await payerAddressOf(session, payer, options, list.manifest?.settings)),
    };
    if (options.json) say(JSON.stringify(facts));
    else {
      sayDryRun(say, `${todo.length} file${todo.length === 1 ? "" : "s"}`, facts);
      if (already.length > 0) say(`  ${already.length} already in the drive, which this would not send again`);
    }
    return 0;
  }

  const json = options.json === true;
  const progress = new Progress(json ? silentSink() : stderrSink(), "uploading");
  const crypt = await loadCrypto();
  const uploaded: string[] = [];
  const reports: Record<string, unknown>[] = [];
  try {
    for (const batch of batchesOf(todo, (one) => planHeavyFile(one.size, rule).length)) {
      const files: HeavyFile[] = [];
      for (const one of batch) files.push(heavyFile(one, await folderFor(session, folderIds, one.folder)));
      const ctx = { session, network, crypt, rule, settings: list.manifest?.settings, say, json, progress };
      const report = await runHeavy(ctx, files, payer, options);
      reports.push(report.facts);
      for (const done of report.files) {
        const added = await recordHeavy(session, done, asked);
        uploaded.push(`${done.destination}/${added.name}`);
      }
    }
  } catch (error) {
    progress.done();
    // ⛔ WHAT IS UPLOADED IS REAL AND PAID FOR — the same words `push.ts` uses, for the same reason.
    const because = error instanceof Error ? error.message : String(error);
    throw new NmtsError(because, {
      exitCode: error instanceof NmtsError ? error.exitCode : 1,
      nextStep:
        uploaded.length === 0
          ? error instanceof NmtsError && error.nextStep !== null
            ? error.nextStep
            : "Nothing was uploaded."
          : `${uploaded.length} file${uploaded.length === 1 ? " is" : "s are"} uploaded and paid ` +
            `for. Running the same command again sends only what is missing.`,
    });
  } finally {
    progress.done();
  }
  if (json) {
    say(JSON.stringify({ files: found.length, uploaded: uploaded.length, skipped: already.length, tier: "heavy", orders: reports }));
    return 0;
  }
  say(``);
  say(`${uploaded.length} sent · ${already.length} already there`);
  return 0;
}
