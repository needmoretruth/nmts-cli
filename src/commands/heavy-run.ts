// The terminal around an NMTS Heavy upload — shared by `put --tier heavy` and `push --tier heavy`:
// which money pays, the review a person reads before anything is spent, the wallet agreement, the
// progress lines, and what a failure says.
//
// ⛔ THE THREE PAYERS AND THEIR STOPS.
//      credits  one order, credits taken when it opens — the same tier as a Standard credit upload.
//      wallet   the order opens first so its WAL price can be printed; the balances are read and a
//               known shortfall stops the run BEFORE anything is sealed; the wallet agreement is held
//               against the price; the WAL is sent only once every part is stored — the same act,
//               lock and review as `put --pay wallet`.
//      evm      developer mode: the key's own EVM wallet pays Filecoin through the Synapse SDK. The
//               same wallet lock; refused before anything is spent where no company is listed.
//
// ⛔ A SERVER REFUSAL IS PRINTED AS ONE. The shared runner wraps whatever stopped it; when that was
//    the server explaining itself, the explanation is what goes out, with the same advice table
//    (`api-advice.ts`) every other refusal uses.

import { ServerError } from "../api.ts";
import { DERIVED, type CryptoGlue } from "../crypto.ts";
import { NmtsError } from "../errors.ts";
import { HEAVY_COPY } from "../heavy-copy.ts";
import { evmAccountFor, evmIndexOf } from "../heavy-evm.ts";
import { copiesOf, heavySelfPut, providersOf, selfPayChain, type SelfPayProgress } from "../heavy-self-pay.ts";
import { heavyCredits, heavyOrderPut, planHeavyFile, type HeavyCommitted, type HeavyFile } from "../heavy-upload.ts";
import { heavyWalletPut } from "../heavy-wallet-pay.ts";
import { addEntry } from "../manifest-write.ts";
import type { Network } from "../network.ts";
import type { Progress } from "../progress.ts";
import type { Session } from "../session.ts";
import { setTrashed } from "../item-trash.ts";
import type { OnCollision } from "../collision.ts";
import type { PaddingRule } from "../shared/lib/crypto/size-padding.ts";
import { activeWalletOf, type AccountSettings } from "../shared/lib/drive/manifest-settings.ts";
import { HeavyOrderError, type HeavyProgress } from "../shared/lib/heavy/order-runner.ts";
import { coinAmount } from "../wallet.ts";
import { recordWalletSpend, requireWalletGrant } from "../wallet-grant.ts";
import { payingWalletIndex } from "../wallet-pay-index.ts";
import { payerOf, refuseWalletOnlyOptions, type HeavyFlags } from "./put-payer.ts";

export type HeavyPayer = "credits" | "wallet" | "evm";

/** What a Heavy command line may carry. */
export interface HeavyCommandOptions extends HeavyFlags {
  pay?: string | undefined;
  epochs?: string | number | undefined;
  storage?: string | undefined;
  from?: string | undefined;
  deposit?: string | number | undefined;
  partSize?: string | number | undefined;
  wallet?: string | undefined;
  trustServerTipAddress?: boolean;
  thumbnail?: boolean;
  thumbnailFile?: string | undefined;
  dryRun?: boolean;
  json?: boolean;
  /** The instant the wallet agreement is measured against. */
  now?: number;
}

export function heavyPayerOf(pay: string | undefined): HeavyPayer {
  return pay === "evm" ? "evm" : payerOf(pay);
}

/** Every option that means nothing on this payer, refused before a file is measured. */
export function refuseHeavyClashes(options: HeavyCommandOptions, payer: HeavyPayer): void {
  const standardOnly = [
    ["--epochs", options.epochs],
    ["--storage", options.storage],
    ["--from", options.from],
    ["--deposit", options.deposit],
    ["--part-size", options.partSize],
    ["--trust-server-tip-address", options.trustServerTipAddress === true ? true : undefined],
    ["--thumbnail", options.thumbnail === true ? true : undefined],
    ["--thumbnail-file", options.thumbnailFile],
  ] as const;
  for (const [flag, value] of standardOnly) {
    if (value !== undefined) throw new NmtsError(HEAVY_COPY.standardOnlyFlag(flag), { exitCode: 2 });
  }
  if (payer !== "evm") {
    for (const [flag, value] of [["--copies", options.copies], ["--providers", options.providers], ["--evm-wallet", options.evmWallet]] as const) {
      if (value !== undefined) throw new NmtsError(HEAVY_COPY.evmOnlyFlag(flag), { exitCode: 2 });
    }
  }
  if (payer !== "wallet") {
    if (options.wallet !== undefined && options.wallet !== "") refuseWalletOnlyOptions({ wallet: options.wallet });
    if (options.days !== undefined) throw new NmtsError(HEAVY_COPY.walletOnlyDays, { exitCode: 2 });
  }
  // Judged now, not after the files are read: a typo must not surface after the money.
  if (payer === "evm") {
    copiesOf(options.copies);
    providersOf(options.providers);
    evmIndexOf(options.evmWallet);
  }
  if (payer === "wallet") termDaysOf(options.days);
}

/** `--days`: 1..365, default 28 — the term a credit buys. */
export function termDaysOf(raw: string | undefined): number {
  if (raw === undefined || raw === "") return 28;
  const value = Number(raw.trim());
  if (!/^[0-9]+$/u.test(raw.trim()) || value < 1 || value > 365) throw new NmtsError(HEAVY_COPY.badDays(raw), { exitCode: 2 });
  return value;
}

export interface HeavyRunContext {
  session: Session;
  network: Network;
  crypt: CryptoGlue;
  rule: PaddingRule;
  settings: AccountSettings | undefined;
  say: (line: string) => void;
  json: boolean;
  progress: Progress;
}

/** What the run did, for the caller's printing and `--json`. */
export interface HeavyRunReport {
  files: HeavyCommitted[];
  facts: Record<string, unknown>;
}

/** The dry run: what is known without opening an order or touching a chain. */
export function heavyDryRun(files: readonly HeavyFile[], rule: PaddingRule, payer: HeavyPayer): Record<string, unknown> {
  const plans = files.map((f) => planHeavyFile(f.source.size, rule));
  return {
    dryRun: true,
    tier: "heavy",
    paidFrom: payer,
    bytes: files.reduce((sum, f) => sum + f.source.size, 0),
    sealedBytes: plans.flat().reduce((sum, p) => sum + p.sealedLen, 0),
    parts: plans.reduce((sum, p) => sum + p.length, 0),
    ...(payer === "credits" ? { credits: plans.reduce((sum, p) => sum + heavyCredits(p), 0) } : {}),
  };
}

function label(files: readonly HeavyFile[]): string {
  return files.length === 1 ? (files[0]?.name ?? "") : `${files.length} files`;
}

/** Upload these files to NMTS Heavy on this payer, and commit them. The caller writes the list. */
export async function runHeavy(
  ctx: HeavyRunContext,
  files: readonly HeavyFile[],
  payer: HeavyPayer,
  options: HeavyCommandOptions,
): Promise<HeavyRunReport> {
  const { session, crypt } = ctx;
  const bytes = files.reduce((sum, f) => sum + f.source.size, 0);
  const now = new Date(options.now ?? Date.now());
  const derived = crypt.kdf_derive(crypt.account_code_parse(session.code));
  const dataKey = derived.slice(DERIVED.dataKey[0], DERIVED.dataKey[1]);
  derived.fill(0);
  try {
    if (payer === "evm") return await runSelfPaid(ctx, files, options, dataKey, now, bytes);
    const onProgress = (event: HeavyProgress): void => tellOrder(ctx, files, event);
    const base = { server: session.server, bearer: session.apiKey, crypt, dataKey, rule: ctx.rule, onProgress };
    if (payer === "credits") {
      const credits = files.reduce((sum, f) => sum + heavyCredits(planHeavyFile(f.source.size, ctx.rule)), 0);
      if (!ctx.json) ctx.say(HEAVY_COPY.creditsPlan(label(files), bytes, credits));
      const { run, files: done } = await heavyOrderPut(base, files, { pay: "credits" });
      return { files: done, facts: { tier: "heavy", paidFrom: "credits", orderId: run.orderId, credits: run.credits ?? credits, expiryEpoch: run.expiryEpoch } };
    }
    return await runWalletPaid(ctx, files, options, base, now, bytes);
  } catch (error) {
    throw heavyFailure(error);
  } finally {
    dataKey.fill(0);
    ctx.progress.done();
  }
}

/** The wallet payer: open, review, check, agree — then run the same order. */
async function runWalletPaid(
  ctx: HeavyRunContext,
  files: readonly HeavyFile[],
  options: HeavyCommandOptions,
  base: Parameters<typeof heavyOrderPut>[0],
  now: Date,
  bytes: number,
): Promise<HeavyRunReport> {
  const { session, network } = ctx;
  const wallet = await payingWalletIndex({ wallet: options.wallet, readActiveWallet: async () => activeWalletOf(ctx.settings) });
  // ⛔ THE AGREEMENT IS ASKED BEFORE AN ORDER OPENS — an unpaid order counts against the day's three.
  requireWalletGrant("seal", { walFrost: 0n, suiMist: 0n }, now);
  const termDays = termDaysOf(options.days);
  const { run, files: done, quote } = await heavyWalletPut(base, files, {
    code: session.code,
    network,
    wallet,
    termDays,
    onQuote: (q) => {
      if (!ctx.json) ctx.say(HEAVY_COPY.walletPlan(label(files), bytes, coinAmount(q.walFrost), termDays, q.address, q.treasury));
    },
    approve: (q) => requireWalletGrant("seal", { walFrost: q.walFrost, suiMist: q.feeMist ?? 0n }, now),
    onPaid: recordWalletSpend,
  });
  return {
    files: done,
    facts: {
      tier: "heavy",
      paidFrom: "wallet",
      orderId: run.orderId,
      priceFrost: quote.walFrost.toString(),
      priceWal: coinAmount(quote.walFrost),
      termDays,
      wallet: quote.address,
      txDigest: run.txDigest ?? null,
      expiryEpoch: run.expiryEpoch,
    },
  };
}

/** The evm payer: this key's own EVM wallet, through the Synapse SDK. */
async function runSelfPaid(
  ctx: HeavyRunContext,
  files: readonly HeavyFile[],
  options: HeavyCommandOptions,
  dataKey: Uint8Array,
  now: Date,
  bytes: number,
): Promise<HeavyRunReport> {
  selfPayChain(ctx.network);
  const copies = copiesOf(options.copies);
  const providers = providersOf(options.providers);
  requireWalletGrant("seal", { walFrost: 0n, suiMist: 0n }, now);
  const account = await evmAccountFor(ctx.session.code, evmIndexOf(options.evmWallet));
  if (!ctx.json) ctx.say(HEAVY_COPY.evmPlan(label(files), bytes, copies, account.address));
  const done = await heavySelfPut(
    {
      server: ctx.session.server,
      bearer: ctx.session.apiKey,
      crypt: ctx.crypt,
      dataKey,
      rule: ctx.rule,
      network: ctx.network,
      account,
      copies,
      providers,
      onProgress: (event) => tellSelf(ctx, files, event),
    },
    files,
  );
  return {
    files: done.files,
    facts: { tier: "heavy", paidFrom: "evm", paidBy: done.paidBy, copies: done.copies, expiryEpoch: done.expiryEpoch, ...(providers === undefined ? {} : { providers: providers.map(String) }) },
  };
}

function where(files: readonly HeavyFile[], fileIndex: number, partIndex: number, parts: number): string {
  const name = files.length > 1 ? ` ${files[fileIndex]?.name ?? ""}` : "";
  return `${name}${parts > 1 ? ` [${partIndex + 1}/${parts}]` : ""}`;
}

function tellOrder(ctx: HeavyRunContext, files: readonly HeavyFile[], event: HeavyProgress): void {
  if (ctx.json) return;
  if (event.phase === "uploading") return ctx.progress.update(event.sentBytes, event.totalBytes);
  if ("fileKey" in event) {
    const fileIndex = Number(event.fileKey.slice(1));
    const parts = planHeavyFile(files[fileIndex]?.source.size ?? 1, ctx.rule).length;
    if (event.phase === "committing") ctx.progress.done();
    return ctx.say(HEAVY_COPY.progress(event.phase, where(files, fileIndex, event.partIndex, parts)));
  }
  ctx.say(HEAVY_COPY.progress(event.phase, ""));
}

function tellSelf(ctx: HeavyRunContext, files: readonly HeavyFile[], event: SelfPayProgress): void {
  if (ctx.json) return;
  if (event.phase === "sent") return ctx.progress.update(event.sentBytes, event.totalBytes);
  if (event.phase === "stored") ctx.progress.done();
  ctx.say(HEAVY_COPY.progress(event.phase, where(files, event.fileIndex, event.partIndex, event.parts)));
}

/** A server refusal as itself; any other stop of the runner in the Heavy words. */
export function heavyFailure(error: unknown): unknown {
  if (!(error instanceof HeavyOrderError)) return error;
  if (error.cause instanceof ServerError) return error.cause;
  return new NmtsError(HEAVY_COPY.failed(error.reason, error.message), { exitCode: 1, nextStep: HEAVY_COPY.failedNext(error.reason) });
}

/** Write each committed file into the sealed list; a displaced one goes to the server's trash last. */
export async function recordHeavy(
  session: Session,
  done: HeavyCommitted,
  onCollision: OnCollision | undefined,
): Promise<{ name: string; replaced: string | null; seq: number }> {
  const now = Date.now();
  const added = await addEntry({
    server: session.server,
    apiKey: session.apiKey,
    code: session.code,
    accountId: session.accountId,
    ...(onCollision !== undefined ? { onCollision } : {}),
    entry: {
      id: done.itemId,
      parentId: done.parentId,
      kind: 1,
      name: done.name,
      size: done.plaintextLen,
      createdAt: now,
      updatedAt: now,
      dekWrapped: done.dekWrapped,
      contentHashCt: done.contentHashCt,
    },
  });
  if (added.replaced) await setTrashed(session.server, session.apiKey, added.replaced.id, true);
  return { name: added.name, replaced: added.replaced?.id ?? null, seq: added.seq };
}
