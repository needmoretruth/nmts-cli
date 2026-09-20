// Buying more storage time for one file that is already stored — worked out, signed and handed
// back rather than printed.
//
// ⛔ ONE IMPLEMENTATION, TWO CALLERS. `nmts extend` is a terminal over this: the sentences a person
//    reads, the agreement this machine keeps, the exit code. The SDK is somebody else's program and
//    needs the same act with none of those. What must not be written twice is the ORDER below,
//    because every step of it is about money that does not come back.
//
// ⛔ IT PRICES BEFORE IT SPENDS, ALWAYS. `planExtension` reads, judges and quotes; it holds no key
//    and signs nothing, so a caller that only wants a price never comes near `applyExtension`.
//
// ⛔ THE SERVER DOES NOT EXTEND ANYTHING. `POST /v1/items/{id}/extended` means "record an extension
//    the device already signed": the storage is bought by the time it is called, so a failure there
//    is a failure to WRITE THE DATE DOWN and comes back as itself. Reporting it as a failure to
//    extend would invite a second run, and a second run pays again.
//
// ⛔ AND THE CHAIN IS THE AUTHORITY ON WHEN A LEASE ENDS, not the server's `expiry_epoch`. The
//    server's answer is used for one thing: knowing WHICH blobs to ask the chain about.
//
// ⚠ Nothing here reaches for `node:`, and the chain and the signer are loaded only when no seam was
//   supplied.

import { request } from "../api.ts";
import { buildIndex, entryAt, fullPathOf, KIND_FILE, normalisePath } from "../drive-paths.ts";
import { NmtsError } from "../errors.ts";
import { budgetFacts, readBudget, type Budget } from "../extend-budget.ts";
import { daysLeftUntilEpoch, stageOf, type DaysLeft, type ExpiryStage } from "../expiry.ts";
import {
  asExtendPreview,
  chooseEpochs,
  headroom,
  soonestEnd,
  type ExtendPreview,
  type ExtendReads,
  type SignExtension,
} from "../extend-plan.ts";
import { isRecord } from "../guards.ts";
import type { StorageHints } from "./hints.ts";
import { readFileList } from "../manifest.ts";
import { activeWalletOf, type AccountSettings } from "../shared/lib/drive/manifest-settings.ts";
import { coinAmount, walletAddress } from "../wallet.ts";

/** Where to talk, what opens the list, and whose list it is. */
export interface ExtendInput {
  server: string;
  apiKey: string;
  /** ⛔ The NMTS key. It opens the list and derives the wallet that pays; it goes nowhere else. */
  code: string;
  accountId: string;
  network: string;
}

/**
 * Everything one run worked out, in one shape.
 *
 * ⛔ ONE OBJECT SO TWO ANSWERS CANNOT DISAGREE. The words a person reads and the JSON a program
 *    reads are built from this and from nothing else; when they were assembled separately the day
 *    count in one of them was the count before the extension and in the other the count after.
 */
export interface ExtendFacts {
  file: string;
  itemId: string;
  network: string;
  epoch: number;
  endEpoch: number;
  epochs: number;
  newEndEpoch: number;
  daysLeft: DaysLeft;
  daysLeftAfter: DaysLeft;
  blobs: number;
  /** ⚠ A STRING: base units run past what a JSON number keeps without losing digits. */
  priceFrost: string;
  priceWal: string;
  /** ⛔ Said in the machine-readable answer too. A program spending WAL should not have to infer it. */
  paidFrom: "wallet";
  filesOnTheSameBlobs: number;
  partsThatCannotBeExtended: number;
  /** The address that would sign. */
  wallet: string;
  /** What it holds, as amounts — null when the chain could not say. ⛔ Never zero for unread. */
  walletWal: string | null;
  walletSui: string | null;
  /** The chain fee a dry run measured — null when it could not be measured. */
  feeMist: string | null;
  feeSui: string | null;
}

/** What one extension would buy, and everything the decision to buy it rests on. */
export interface ExtendPlan {
  facts: ExtendFacts;
  itemId: string;
  /** The file's full path in the account, as the list spells it. */
  path: string;
  /** The blobs the transaction would name. */
  objectIds: readonly string[];
  epochs: number;
  /**
   * ⚠ THE WALLET'S NUMBER. `facts.wallet` is that wallet's address — the one the price was measured
   *   against, and the one that signs.
   */
  wallet: number;
  /**
   * How close this file is to running out.
   *
   * ⛔ `later` IS NOT A REFUSAL HERE. Extending early loses nothing — the epochs are added to what
   *    is left — so whether to spend now for time a file does not need yet is the caller's to
   *    decide, and each surface names its own way of saying yes.
   */
  stage: ExpiryStage;
  budget: Budget;
  /** The sealed list's settings, as read for this price. */
  settings: AccountSettings | undefined;
}

/** The chain reads. ⚠ A SEAM, NOT AN OPTION — no flag and no caller argument reaches it. */
export interface ExtendPlanSeams {
  readChain?: ((network: string) => Promise<ExtendReads> | ExtendReads) | undefined;
  /** How many of the storage network's epochs to add. Default `DEFAULT_EXTEND_EPOCHS`. */
  epochs?: string | number | undefined;
  /** Which of this key's wallets pays. Absent = the account's own number, out of the list read here. */
  wallet?: number | undefined;
  /**
   * A wallet OUTSIDE this tool that pays instead — its address, because this is where the price is
   * measured against a balance.
   *
   * ⛔ THE SIGNATURE HAS TO COME FROM THE SAME ADDRESS (`wallet-sign-external.ts`), and the blobs
   *    have to be ones that wallet paid for: extending storage is a payment by whoever holds it.
   */
  payer?: { address: string } | undefined;
  /** The instant to measure against. Passed in so one run reports one moment. */
  now: number;
  /** What this caller wants said in a refusal instead of the neutral sentence. */
  hints?: StorageHints | undefined;
}

/**
 * Work out what extending this file would buy and what it would cost, without signing anything.
 *
 * ⛔ NO KEY IS DERIVED FOR SIGNING AND NO SIGNER IS LOADED. Everything here is a read, which is
 *    what lets a price be asked for without an agreement being asked for first.
 */
export async function planExtension(
  input: ExtendInput,
  target: string,
  seams: ExtendPlanSeams,
): Promise<ExtendPlan> {
  const list = await readFileList(input.server, input.apiKey, input.code, input.accountId);
  if (list.manifest === null) {
    throw new NmtsError("This account has no file list, so there is nothing to extend.", { exitCode: 4 });
  }
  const entries = list.manifest.entries;
  const settings = list.manifest.settings;
  const entry = entryAt(entries, normalisePath(target), {
    nothingHappened: "Nothing was signed and nothing was charged.",
  });
  if (entry.kind !== KIND_FILE) {
    throw new NmtsError(`No file at "${fullPathOf(buildIndex(entries), entry)}".`, {
      exitCode: 4,
      nextStep:
        "That is a folder. Nothing was signed and nothing was charged — storage is bought per " +
        "file, so this takes one file at a time.",
    });
  }
  const path = fullPathOf(buildIndex(entries), entry);

  // ⛔ THE SERVER SAYS WHICH BLOBS, AND NOTHING ELSE. Its `expiry_epoch` is client-reported and
  //    advisory; anything that spends money reads the chain's own answer below.
  const preview = asExtendPreview(
    await request(input.server, `/v1/items/${encodeURIComponent(entry.id)}/extend-preview`, {
      token: input.apiKey,
    }),
  );
  if (preview.targets.length === 0) {
    throw new NmtsError(`Nothing on "${path}" can be extended from here.`, {
      exitCode: 4,
      nextStep: nothingToExtend(preview),
    });
  }

  const reads = await (seams.readChain ?? defaultReads)(input.network);
  const window = await reads.readWindow();
  if (window === null) {
    // ⛔ Not "nothing needs extending". The two look identical from outside and mean opposite things.
    throw new NmtsError(`The ${input.network} storage network could not be read.`, {
      exitCode: 1,
      nextStep:
        `Nothing was signed and nothing was charged. Which epoch the network is in, and how far ` +
        `ahead it will sell, are facts only the chain has — this will not spend against a ` +
        `guess. Try again, or name a different Sui node in NMTS_SUI_RPC.`,
    });
  }
  const clock = window.clock;
  const objectIds = preview.targets.map((t) => t.objectId);
  const leases = await reads.readLeases(objectIds);
  const endEpoch = soonestEnd(leases);
  if (endEpoch === null) {
    throw new NmtsError(`The chain holds no storage term for "${path}".`, {
      exitCode: 4,
      nextStep: nothingToExtend(preview),
    });
  }

  const stage = stageOf(clock, endEpoch, seams.now);
  if (stage === "lapsed") {
    throw new NmtsError(`The storage term for "${path}" has already ended.`, {
      exitCode: 4,
      nextStep:
        seams.hints?.lapsed ??
        `Nothing was signed and nothing was charged. A lease is extended before it ends — once it ` +
          `is over there is no storage object left to extend, and the bytes may already be gone. ` +
          `Fetching the file is what says whether they can still be read.`,
    });
  }

  const epochs = chooseEpochs(seams.epochs, headroom(leases, clock.current, window.maxAhead));
  const newEndEpoch = endEpoch + epochs;
  const before = daysLeftUntilEpoch(clock, endEpoch, seams.now);
  const after = daysLeftUntilEpoch(clock, newEndEpoch, seams.now);
  // ⛔ A COST THAT COULD NOT BE COMPUTED MUST NOT BECOME A COST OF ZERO. `quote` rejects rather
  //    than defaulting, and that rejection stops this run before anything is agreed to.
  const frost = await reads.quote(leases, epochs);
  const cohort = Math.max(0, ...preview.targets.map((t) => t.sharedItems));
  const unreachable = preview.treasuryParts + preview.untrackedParts;
  // ⛔ WHICH WALLET PAYS comes out of the list this run already read, before the price is measured
  //    against a balance: the address below is the one that will sign.
  const wallet = seams.wallet ?? activeWalletOf(settings);
  const address = seams.payer?.address ?? (await walletAddress(input.code, wallet));
  const budget = await readBudget(reads, { address, objectIds, epochs, priceFrost: frost });

  return {
    facts: {
      file: path,
      itemId: entry.id,
      network: input.network,
      epoch: clock.current,
      endEpoch,
      epochs,
      newEndEpoch,
      daysLeft: before,
      daysLeftAfter: after,
      blobs: leases.length,
      priceFrost: frost.toString(),
      priceWal: coinAmount(frost),
      paidFrom: "wallet",
      filesOnTheSameBlobs: cohort,
      partsThatCannotBeExtended: unreachable,
      ...budgetFacts(budget),
    },
    itemId: entry.id,
    path,
    objectIds,
    epochs,
    wallet,
    stage,
    budget,
    settings,
  };
}

/** What one extension did. ⛔ By the time this exists, the storage IS extended and paid for. */
export interface ExtendOutcome {
  /** The transaction digest — what the server records as the replay guard. */
  digest: string;
  /** Whether the server wrote the new date down. */
  recorded: boolean;
  /** True when the server had already recorded this digest, so nothing was written twice. */
  replay: boolean;
  /**
   * Why the date was not written down, in the words the failure gave. Null when it was.
   *
   * ⛔ IT IS NOT AN EXCEPTION, and that is the whole point: the money is already spent, so a caller
   *    that saw a throw here would reasonably try again — and trying again pays again.
   */
  notRecorded: string | null;
}

/** The signature, and the one moment a caller may want between it and the server. ⚠ Seams. */
export interface ExtendApplySeams {
  sign?: SignExtension | undefined;
  /** Told the instant the signature exists — before the server is asked to write the date down. */
  onSigned?: ((digest: string) => void) | undefined;
}

/**
 * Buy it. ⛔ THIS SIGNS, and nothing below this line can be undone by anybody, NMTS included.
 *
 * Nothing here asks whether the caller meant it: the price, both balances and any shortfall are in
 * the plan, and calling this is the answer.
 */
export async function applyExtension(
  input: ExtendInput,
  plan: ExtendPlan,
  seams: ExtendApplySeams = {},
): Promise<ExtendOutcome> {
  const sign = seams.sign ?? (await import("../wallet-sign.ts")).signExtension;
  const digest = await sign({
    network: input.network,
    code: input.code,
    wallet: plan.wallet,
    objectIds: plan.objectIds,
    epochs: plan.epochs,
  });
  seams.onSigned?.(digest);

  // From here the storage IS extended. Recording it is bookkeeping, and a failure to record must
  // never be reported as a failure to extend — that reading invites a second run, which pays again.
  try {
    const recorded = await request(
      input.server,
      `/v1/items/${encodeURIComponent(plan.itemId)}/extended`,
      { method: "POST", token: input.apiKey, body: { epochs: plan.epochs, tx_digest: digest } },
    );
    return { digest, recorded: true, replay: isRecord(recorded) && recorded["replay"] === true, notRecorded: null };
  } catch (error) {
    return {
      digest,
      recorded: false,
      replay: false,
      notRecorded: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Why a file has nothing to extend, said as the two different things it can be. */
export function nothingToExtend(preview: ExtendPreview): string {
  const parts: string[] = [];
  if (preview.treasuryParts > 0) {
    parts.push(
      `${preview.treasuryParts} part${preview.treasuryParts === 1 ? " is" : "s are"} on storage NMTS ` +
        `paid for, which this account cannot extend`,
    );
  }
  if (preview.untrackedParts > 0) {
    parts.push(
      `${preview.untrackedParts} part${preview.untrackedParts === 1 ? " has" : "s have"} no ` +
        `recorded storage object, so there is nothing to name on the chain`,
    );
  }
  const why = parts.length === 0 ? "The server lists no storage object for it." : `${parts.join(", and ")}.`;
  return `Nothing was signed and nothing was charged. ${why} Opening the account in a browser shows what it is stored on.`;
}

/** The real chain reads. Imported only when no seam was supplied — it loads the storage SDK. */
async function defaultReads(network: string): Promise<ExtendReads> {
  return (await import("../extend-chain.ts")).extendReads(network);
}
