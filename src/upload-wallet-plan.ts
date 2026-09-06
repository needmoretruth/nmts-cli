// What a WALLET-PAID upload would buy, worked out before anything is sealed or signed.
//
// ⛔ NO NETWORK, NO SDK, NO KEY. Everything here is arithmetic over numbers somebody else read, so
//    `node --test` drives every branch — the shortfalls, the resource that does not fit, the length
//    the network will not sell. The reads live in `upload-wallet-chain.ts`, the signatures in
//    `wallet-sign.ts`, and neither can be reached from here.
//
// ⛔ THE PRICE HAS THREE PARTS AND THE REVIEW SAYS ALL THREE. Storage and the write are WAL; the
//    relay's tip and the chain fee are SUI. The browser's payment sheet itemises exactly these, and
//    a person comparing the two programs should see the same numbers under the same names.
//
// ⛔ AN UNREAD BALANCE IS NOT A SHORTFALL — the rule `extend-budget.ts` states, kept here where it
//    costs the most: a zero would refuse an upload the wallet can afford.

import { NmtsError } from "./errors.ts";
import type { ExtendWindow } from "./extend-plan.ts";
import { BINARY_NAME } from "./product.ts";
import type { StorageResource } from "./shared/lib/storage-control/chain.ts";
import { fits, leftoverBytes, statusOf, usableFirst } from "./shared/lib/storage-control/plan.ts";
import { coinAmount, type CoinBalance, type WalletBalances } from "./wallet.ts";

/** The browser's default rung, and the term one credit buys. A number of EPOCHS, not days. */
export const DEFAULT_UPLOAD_EPOCHS = 2;

/** What ONE part costs, as the chain quotes it. Base units throughout. */
export interface PartQuote {
  sealedLen: number;
  /** Storage over time, in FROST. Zero when a held resource supplies the storage. */
  storageFrost: bigint;
  /** The write, in FROST. Charged whoever supplies the storage. */
  writeFrost: bigint;
  /** The relay's tip, in MIST. */
  tipMist: bigint;
}

/** Where a part's storage comes from. */
export type StorageChoice =
  | { kind: "buy" }
  | {
      kind: "reuse";
      objectId: string;
      /** Cut the resource down to this many bytes first (`fit`), or null to bind it whole. */
      cutToBytes: number | null;
      /** The write cost, which a held resource does not cover. */
      writeFrost: bigint;
      /** What the resource holds beyond this part, once encoded — bound with the file, or left over. */
      leftoverBytes: number;
      resource: StorageResource;
    };

/** One part as the register transaction needs it. */
export interface RegisterShape {
  epochs: number;
  storage: { kind: "buy" } | { kind: "reuse"; objectId: string; cutToBytes: number | null; writeFrost: bigint };
  part: { sealedLen: number; blobId: string; rootHash: Uint8Array; nonce: Uint8Array; blobDigest: Uint8Array };
}

/** The chain, as a wallet-paid upload READS it. ⚠ A seam — no flag reaches it. */
export interface WalletUploadReads {
  readWindow(): Promise<ExtendWindow | null>;
  quoteParts(sealedLens: readonly number[], epochs: number): Promise<PartQuote[]>;
  readWallet(address: string): Promise<WalletBalances>;
  /** The fee of ONE register signature, measured by a dry run — or null when it could not be. */
  estimateRegisterGas(input: {
    sender: string;
    sealedLen: number;
    epochs: number;
    storage: RegisterShape["storage"];
  }): Promise<bigint | null>;
  /** The free storage resources the wallet holds. Rejects when they could not be read. */
  readStorage(address: string): Promise<StorageResource[]>;
  /** What a part of this many sealed bytes occupies once encoded — the chain's own number. */
  encodedLength(sender: string, sealedLen: number): Promise<number>;
}

/**
 * How many epochs to buy: what was asked for, or the browser's default, held against the ceiling.
 *
 * ⛔ IT REFUSES RATHER THAN CLAMPS, for the reason `extend-plan.ts` gives: quietly buying fewer
 *    epochs spends money on something nobody asked for.
 */
export function chooseUploadEpochs(asked: string | number | undefined, window: ExtendWindow): number {
  const epochs = asked === undefined ? DEFAULT_UPLOAD_EPOCHS : typeof asked === "number" ? asked : Number(asked.trim());
  if (!Number.isSafeInteger(epochs) || epochs <= 0) {
    throw new NmtsError(`A storage term is a whole number of epochs: ${String(asked)}.`, {
      exitCode: 2,
      nextStep: `Nothing was signed. \`--epochs 4\` buys four of the storage network's epochs — ${daysOf(window, 1)} each.`,
    });
  }
  if (epochs > window.maxAhead) {
    throw new NmtsError(`The storage network sells at most ${window.maxAhead} epochs ahead.`, {
      exitCode: 4,
      nextStep: `Nothing was signed. Ask for ${window.maxAhead} or fewer: \`${BINARY_NAME} put <file> --pay wallet --epochs ${window.maxAhead}\`.`,
    });
  }
  return epochs;
}

/** A number of epochs as days, read from the network's own clock. */
export function daysOf(window: ExtendWindow, epochs: number): string {
  const days = (epochs * window.clock.durationMs) / 86_400_000;
  const rounded = Number.isInteger(days) ? String(days) : days.toFixed(1);
  return `${rounded} day${days === 1 ? "" : "s"}`;
}

/** What `--storage` asks for. */
export type StorageAsk = { mode: "fit" } | { mode: "whole" } | { mode: "object"; objectId: string };

export function parseStorageAsk(text: string | undefined): StorageAsk | null {
  if (text === undefined || text === "") return null;
  if (text === "fit" || text === "whole") return { mode: text };
  if (/^0x[0-9a-fA-F]{64}$/.test(text)) return { mode: "object", objectId: text.toLowerCase() };
  throw new NmtsError(`--storage takes fit, whole, or a storage resource's object id, not "${text}".`, {
    exitCode: 2,
    nextStep: `\`${BINARY_NAME} wallet storage\` lists the resources this wallet holds.`,
  });
}

/**
 * Which held resource supplies this part's storage, and how much of it.
 *
 * ⛔ THE LEFTOVER IS A NUMBER THE PERSON SEES — the owner's rule: registration binds the WHOLE resource,
 *    so `whole` says how many bytes go in with the file, and `fit` cuts first and says what stays
 *    free. `fit` and `whole` pick the smallest usable resource that fits; an object id names one.
 */
export function pickResource(
  ask: StorageAsk,
  resources: readonly StorageResource[],
  encodedBytes: number,
  currentEpoch: number,
  needUntilEpoch: number,
  writeFrost: bigint,
): StorageChoice {
  const usable = usableFirst(resources, currentEpoch).filter((r) => statusOf(r, currentEpoch) === "usable");
  let chosen: StorageResource | undefined;
  if (ask.mode === "object") {
    chosen = resources.find((r) => r.objectId === ask.objectId);
    if (chosen === undefined) {
      throw new NmtsError(`This wallet holds no free storage resource ${ask.objectId}.`, {
        exitCode: 4,
        nextStep: `Nothing was signed. \`${BINARY_NAME} wallet storage\` lists what it holds.`,
      });
    }
    if (!fits(chosen, encodedBytes, needUntilEpoch) || statusOf(chosen, currentEpoch) !== "usable") {
      throw new NmtsError(`Resource ${ask.objectId} cannot hold this part until epoch ${needUntilEpoch}.`, {
        exitCode: 4,
        nextStep:
          `Nothing was signed. It holds ${chosen.sizeBytes} bytes from epoch ${chosen.startEpoch} to ` +
          `${chosen.endEpoch}; this part is ${encodedBytes} bytes once encoded. Leave --storage off to buy new storage.`,
      });
    }
  } else {
    // Smallest first among those that fit: the one that wastes least when bound whole.
    chosen = usable.filter((r) => fits(r, encodedBytes, needUntilEpoch)).sort((a, b) => a.sizeBytes - b.sizeBytes)[0];
    if (chosen === undefined) {
      throw new NmtsError(`No free storage resource in this wallet holds ${encodedBytes} encoded bytes until epoch ${needUntilEpoch}.`, {
        exitCode: 4,
        nextStep:
          `Nothing was signed. \`${BINARY_NAME} wallet storage\` lists what it holds; leave --storage off ` +
          `to buy new storage, or ask for fewer epochs.`,
      });
    }
  }
  const cut = ask.mode === "fit";
  return {
    kind: "reuse",
    objectId: chosen.objectId,
    cutToBytes: cut ? encodedBytes : null,
    writeFrost,
    leftoverBytes: leftoverBytes(chosen, encodedBytes),
    resource: chosen,
  };
}

/** The wallet against the price — before the agreement, before any signature. */
export interface UploadBudget {
  readonly address: string;
  readonly walNeededFrost: bigint;
  /** Tips plus the measured register fee per part. The certify fees are on top and unmeasured. */
  readonly suiNeededMist: bigint;
  readonly walFrost: bigint | null;
  readonly suiMist: bigint | null;
  readonly feeMist: bigint | null;
  readonly unread: readonly string[];
  readonly shortfall: string | null;
}

function held(coin: CoinBalance): bigint | null {
  return coin.read ? coin.baseUnits : null;
}

export function uploadBudget(input: {
  address: string;
  purse: WalletBalances;
  feeMist: bigint | null;
  quotes: readonly PartQuote[];
  storage: StorageChoice;
}): UploadBudget {
  const { address, purse, feeMist, quotes, storage } = input;
  const walNeededFrost = walPrice(quotes, storage);
  const tips = quotes.reduce((sum, q) => sum + q.tipMist, 0n);
  const suiNeededMist = tips + (feeMist ?? 0n) * BigInt(quotes.length);
  const walFrost = held(purse.wal);
  const suiMist = held(purse.sui);
  const unread: string[] = [];
  if (!purse.wal.read) unread.push(`WAL: ${purse.wal.why}`);
  if (!purse.sui.read) unread.push(`SUI: ${purse.sui.why}`);
  let shortfall: string | null = null;
  if (walFrost !== null && walFrost < walNeededFrost) {
    shortfall = `The wallet holds ${coinAmount(walFrost)} WAL and this upload costs ${coinAmount(walNeededFrost)} WAL.`;
  } else if (suiMist !== null && suiMist < suiNeededMist) {
    shortfall =
      `The wallet holds ${coinAmount(suiMist)} SUI and this upload needs about ${coinAmount(suiNeededMist)} SUI ` +
      `for the relay tip and the chain fees.`;
  }
  return { address, walNeededFrost, suiNeededMist, walFrost, suiMist, feeMist, unread, shortfall };
}

/** WAL for the whole file: storage and write when buying, the write alone on a held resource. */
export function walPrice(quotes: readonly PartQuote[], storage: StorageChoice): bigint {
  return quotes.reduce(
    (sum, q) => sum + q.writeFrost + (storage.kind === "buy" ? q.storageFrost : 0n),
    0n,
  );
}

/** The next step when the wallet is short: where to send what, said once. */
export function uploadShortfallNextStep(b: UploadBudget): string {
  const coin = b.walFrost !== null && b.walFrost < b.walNeededFrost ? "WAL" : "SUI";
  return (
    `Nothing was signed and nothing was sent. Send ${coin} to ${b.address} — ` +
    `\`${BINARY_NAME} wallet\` shows the address and both balances — and run this again.`
  );
}

/** The numbers, for a person, in the order somebody deciding needs them. */
export function describeUploadReview(
  say: (line: string) => void,
  facts: {
    name: string;
    bytes: number;
    parts: number;
    epochs: number;
    days: string;
    endEpoch: number;
    walNeeded: bigint;
    tipMist: bigint;
    storage: StorageChoice;
    heldResources: number | null;
  },
  budget: UploadBudget,
): void {
  say(`${facts.name}  ${facts.bytes} bytes  →  ${coinAmount(facts.walNeeded)} WAL from the wallet`);
  if (facts.parts > 1) say(`  in ${facts.parts} parts — each one is registered and certified with its own signatures`);
  say(`  Stored for ${facts.epochs} epoch${facts.epochs === 1 ? "" : "s"} — ${facts.days} — until epoch ${facts.endEpoch}.`);
  if (facts.storage.kind === "reuse") {
    const r = facts.storage.resource;
    say(`  Storage comes from resource ${r.objectId} (${r.sizeBytes} bytes, until epoch ${r.endEpoch}); the WAL above is the write alone.`);
    say(
      facts.storage.cutToBytes === null
        ? `  Used whole: ${facts.storage.leftoverBytes} bytes beyond this file are bound with it and cannot be taken back.`
        : `  Cut to fit: ${facts.storage.leftoverBytes} bytes stay free as a resource of their own.`,
    );
  } else if (facts.heldResources !== null && facts.heldResources > 0) {
    say(`  This wallet also holds ${facts.heldResources} free storage resource${facts.heldResources === 1 ? "" : "s"} — \`${BINARY_NAME} wallet storage\` lists them; --storage fit or whole tries one.`);
  }
  say(`  Relay tip ${coinAmount(facts.tipMist)} SUI, paid inside the register signature${facts.parts > 1 ? "s" : ""}.`);
  if (budget.feeMist === null) {
    say(`  The chain fee (SUI) of a register signature could not be measured just now; it is charged with each signature.`);
  } else {
    say(
      `  Chain fee about ${coinAmount(budget.feeMist)} SUI per register signature, measured by a dry run just now; ` +
        `each certify signature pays its own smaller fee on top.`,
    );
  }
  const wal = budget.walFrost === null ? "WAL not read" : `${coinAmount(budget.walFrost)} WAL`;
  const sui = budget.suiMist === null ? "SUI not read" : `${coinAmount(budget.suiMist)} SUI`;
  say(`  Wallet ${budget.address} holds ${wal} and ${sui}.`);
  if (budget.walFrost !== null && budget.suiMist !== null) {
    const walAfter = budget.walFrost - budget.walNeededFrost;
    const suiAfter = budget.suiMist - budget.suiNeededMist;
    say(`  Afterwards it holds about ${coinAmount(walAfter < 0n ? 0n : walAfter)} WAL and ${coinAmount(suiAfter < 0n ? 0n : suiAfter)} SUI.`);
  }
  for (const why of budget.unread) {
    say(`  A balance could not be read — ${why}. That is not zero: the chain decides at signing.`);
  }
  say(``);
  say(`  This is paid in WAL and SUI from the wallet this NMTS key derives — not from credits, which`);
  say(`  is what \`${BINARY_NAME} put\` spends without --pay wallet. Nobody, NMTS included, can reverse it.`);
  say(`  The storage is the wallet's own: NMTS records the file and does not hold it. This upload does`);
  say(`  not carry the recovery list's storage-network copy, whatever the account's switch says —`);
  say(`  only the browser's small-file uploads do.`);
}
