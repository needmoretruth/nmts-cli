// `nmts put <file> --tier heavy` — one file into NMTS Heavy: whole copies kept by two separate
// storage companies on Filecoin. Paid with credits (the default), with WAL from the wallet
// (`--pay wallet`), or — developer mode — by this key's own EVM wallet (`--pay evm`).
//
// ⛔ EVERYTHING BUT THE ONE FILE IS `heavy-run.ts`: the payer, the review, the agreement, the progress
//    and the failure words are the same for `push --tier heavy`, so they live once.

import { basename, resolve } from "node:path";

import { parseAsked } from "../collision.ts";
import { loadCrypto } from "../crypto.ts";
import { NmtsError } from "../errors.ts";
import { HEAVY_COPY } from "../heavy-copy.ts";
import { evmAddressFor, evmIndexOf } from "../heavy-evm.ts";
import { copiesOf } from "../heavy-self-pay.ts";
import type { HeavyFile } from "../heavy-upload.ts";
import { paddingRuleOf, readFileList } from "../manifest.ts";
import { resolveNetwork } from "../network.ts";
import { BINARY_NAME } from "../product.ts";
import { Progress, silentSink } from "../progress.ts";
import { stderrSink } from "../progress-node.ts";
import { openSession, type Session } from "../session.ts";
import { activeWalletOf, type AccountSettings } from "../shared/lib/drive/manifest-settings.ts";
import { fileSource } from "../upload-file-node.ts";
import { measureLocal } from "../upload-price-node.ts";
import { walletAddress } from "../wallet.ts";
import { payingWalletIndex } from "../wallet-pay-index.ts";
import { heavyDryRun, heavyPayerOf, recordHeavy, refuseHeavyClashes, runHeavy, termDaysOf, type HeavyPayer } from "./heavy-run.ts";
import { folderIdFor, type PutOptions } from "./put.ts";

/** Who would pay, by address, for a dry run — derived offline, nothing signed. */
export async function payerAddressOf(
  session: Session,
  payer: HeavyPayer,
  options: PutOptions,
  settings: AccountSettings | undefined,
): Promise<Record<string, unknown>> {
  if (payer === "evm") {
    return { payer: await evmAddressFor(session.code, evmIndexOf(options.evmWallet)), copies: copiesOf(options.copies) };
  }
  if (payer === "credits") return {};
  const wallet = await payingWalletIndex({ wallet: options.wallet, readActiveWallet: async () => activeWalletOf(settings) });
  return { wallet: await walletAddress(session.code, wallet), termDays: termDaysOf(options.days) };
}

/** The dry run's words for a person: one plan line per payer, and the closing line. */
export function sayDryRun(say: (line: string) => void, name: string, facts: Record<string, unknown>): void {
  const bytes = typeof facts["bytes"] === "number" ? facts["bytes"] : 0;
  if (typeof facts["credits"] === "number") say(HEAVY_COPY.creditsPlan(name, bytes, facts["credits"]));
  if (typeof facts["payer"] === "string") say(HEAVY_COPY.evmPlan(name, bytes, Number(facts["copies"]), facts["payer"]));
  if (typeof facts["wallet"] === "string") say(HEAVY_COPY.walletDryPlan(name, bytes, Number(facts["termDays"]), facts["wallet"]));
  say(HEAVY_COPY.dryRunEnd);
}

export async function putHeavy(target: string | undefined, options: PutOptions): Promise<number> {
  const say = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const payer = heavyPayerOf(options.pay);
  refuseHeavyClashes(options, payer);
  if (target === undefined || target === "") {
    throw new NmtsError("Say which file to put.", {
      exitCode: 2,
      nextStep: `\`${BINARY_NAME} put <file>\` — a path on this machine.`,
    });
  }
  const localPath = resolve(target);
  const size = measureLocal(localPath);
  const session = await openSession({ server: options.server, network: options.network });
  const network = resolveNetwork(session.server, session.network);
  const asked = parseAsked(options.onCollision);
  const list = await readFileList(session.server, session.apiKey, session.code, session.accountId);
  const rule = paddingRuleOf(list.manifest?.settings);
  const name = options.name ?? basename(localPath);
  const destination = (options.to ?? "").replace(/^\.?\//, "").replace(/\/$/, "");
  const parentId = folderIdFor(options.to, list.manifest?.entries ?? []);
  const file: HeavyFile = { source: fileSource(localPath, size), name, parentId, destination };

  if (options.dryRun === true) {
    const facts = { ...heavyDryRun([file], rule, payer), ...(await payerAddressOf(session, payer, options, list.manifest?.settings)) };
    if (options.json) say(JSON.stringify({ name, ...facts }));
    else sayDryRun(say, name, facts);
    return 0;
  }

  const json = options.json === true;
  const report = await runHeavy(
    {
      session,
      network,
      crypt: await loadCrypto(),
      rule,
      settings: list.manifest?.settings,
      say,
      json,
      progress: new Progress(json ? silentSink() : stderrSink(), "uploading"),
    },
    [file],
    payer,
    options,
  );
  const done = report.files[0];
  if (done === undefined) throw new NmtsError(HEAVY_COPY.commitNoId, { nextStep: HEAVY_COPY.commitNoIdNext });
  const added = await recordHeavy(session, done, asked);
  if (json) {
    say(
      JSON.stringify({
        id: done.itemId,
        name: added.name,
        bytes: size,
        sealedBytes: done.sealedBytes,
        parts: done.parts,
        ...report.facts,
        renamed: added.name !== name,
        ...(added.replaced === null ? {} : { replacedIntoTrash: added.replaced }),
        fileListVersion: added.seq,
      }),
    );
    return 0;
  }
  say(`  saved as ${added.name}`);
  if (typeof report.facts["expiryEpoch"] === "number") say(HEAVY_COPY.stored(report.facts["expiryEpoch"]));
  if (added.replaced !== null) {
    say(``);
    say(`  A file called ${name} was already there. It is in the trash now — ${BINARY_NAME} restore`);
    say(`  brings it back for 30 days. This machine is set to overwrite: ${BINARY_NAME} on-collision`);
  } else if (added.name !== name) {
    say(``);
    say(`  A file called ${name} was already there, so this one was numbered rather than`);
    say(`  replacing it. This machine is set to rename: ${BINARY_NAME} on-collision`);
  }
  return 0;
}
