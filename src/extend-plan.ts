// What extending a file's storage would buy, worked out before anything is signed.
//
// ⛔ NO NETWORK, NO SDK, NO KEY. Everything here is arithmetic over numbers somebody else read, so
//    `node --test` can drive every branch — including the ones a live storage network only reaches
//    by being at its ceiling, or by having sold a lease that already ran out. The reads live in
//    `extend-chain.ts`, the signature in `extend-sign.ts`, and neither can be reached from here.
//
// ⛔ THE CHAIN IS THE AUTHORITY ON WHEN A LEASE ENDS, not the server's `expiry_epoch`. That column
//    is client-reported and advisory — it is what `nmts expiring` ranks by, because ranking is all
//    it does — and a command that spends money reads the Blob object itself. The server's answer
//    is used for exactly one thing: knowing WHICH blobs to ask the chain about.
//
// ⛔ AND AN EXTENSION IS ADDED TO WHAT IS LEFT, never counted from today. Extending early loses
//    nothing, which is why this tool is allowed to offer it at all; the new end is
//    `endEpoch + epochs`, and that is the number every day count below is measured from.

import { NmtsError } from "./errors.ts";
import type { EpochClock } from "./expiry.ts";
import { isRecord } from "./guards.ts";
import { BINARY_NAME } from "./product.ts";

/**
 * The longest extension the NMTS server will RECORD, in epochs.
 *
 * ⛔ IT IS THE SERVER'S NUMBER AND IT IS CHECKED HERE ANYWAY, before the money moves. `api`'s
 *    `MAX_EXTEND_EPOCHS` (routes/storage.rs) refuses to record anything longer — and the recording
 *    happens AFTER the signature, so a length the chain would happily sell and the server would
 *    refuse to write down produces the worst outcome this command has: storage that is really
 *    extended, paid for, and a drive that goes on saying the old date.
 *
 * ⚠ A SECOND COPY, deliberately. The alternative is discovering the limit from a 400 after
 *   spending. `check:cli-routes` holds the addresses level; nothing holds this number level, so it
 *   is named with its origin and the refusal it produces says what the server would have said.
 */
export const MAX_RECORDABLE_EPOCHS = 104;

/**
 * How long an extension is when nobody says.
 *
 * The same term one credit buys on the upload rail (`upload-price.ts`, `UPLOAD_EPOCHS`) and the
 * cheapest rung the browser's picker offers. ⚠ It is a number of EPOCHS, not of days: two epochs
 * is two days on testnet and twenty-eight on mainnet, so every surface that prints it prints the
 * days beside it, read from the network's own clock.
 */
export const DEFAULT_EXTEND_EPOCHS = 2;

/** One blob an extension would name, as the NMTS server describes it. */
export interface ExtendTarget {
  /** The Sui object id of the blob — the argument the extend transaction takes. */
  objectId: string;
  /**
   * How many of this account's files ride on this blob, trash included.
   *
   * 1 for a file with a blob to itself; more for a quilt, where ONE payment extends the whole
   * cohort. It is printed rather than used: somebody paying for one file deserves to know the
   * payment reaches five.
   */
  sharedItems: number;
}

/** What `GET /v1/items/{id}/extend-preview` says, narrowed rather than trusted. */
export interface ExtendPreview {
  targets: ExtendTarget[];
  /** Parts on treasury-paid storage — not this account's to extend. */
  treasuryParts: number;
  /** Parts with no recorded Sui object id (pre-0010): nothing to name on-chain. */
  untrackedParts: number;
}

/**
 * The preview, or a refusal.
 *
 * ⛔ A TARGET THIS CANNOT READ IS A REFUSAL, NOT A TARGET TO SKIP. Skipping one would produce a
 *    transaction that extends some of a file's blobs and leaves the others to expire — and the
 *    file is unreadable if any single one of them goes, so the money would buy nothing.
 */
export function asExtendPreview(value: unknown): ExtendPreview {
  const unreadable = (): never => {
    throw new NmtsError("The server answered with an extension plan this version cannot read.", {
      nextStep: "Update this tool. Nothing was signed, and nothing was charged.",
    });
  };
  if (!isRecord(value)) return unreadable();
  const raw: unknown = value["targets"];
  if (!Array.isArray(raw)) return unreadable();
  const targets: ExtendTarget[] = [];
  for (const item of raw) {
    if (!isRecord(item)) return unreadable();
    const objectId: unknown = item["sui_object_id"];
    const shared: unknown = item["shared_items"];
    if (typeof objectId !== "string" || objectId === "") return unreadable();
    if (typeof shared !== "number" || !Number.isFinite(shared)) return unreadable();
    targets.push({ objectId, sharedItems: shared });
  }
  const treasury: unknown = value["treasury_parts"];
  const untracked: unknown = value["untracked_parts"];
  if (typeof treasury !== "number" || typeof untracked !== "number") return unreadable();
  return { targets, treasuryParts: treasury, untrackedParts: untracked };
}

/** One blob's lease, as the chain currently has it. */
export interface BlobLease {
  objectId: string;
  /** Unencoded size in bytes — what the storage price is computed from. */
  size: number;
  /** The epoch the lease runs out at. THE authoritative expiry. */
  endEpoch: number;
}

/**
 * When the file actually runs out: the SOONEST end epoch across the blobs it rides on.
 *
 * ⛔ SOONEST, NOT FURTHEST. One expired blob is enough to make the file unreadable, so the file's
 *    deadline is the first of them. Null when there is no lease to read, which is a real state
 *    (every part on treasury-paid storage) and is never drawn as "now".
 */
export function soonestEnd(leases: readonly BlobLease[]): number | null {
  if (leases.length === 0) return null;
  return Math.min(...leases.map((l) => l.endEpoch));
}

/**
 * The largest number of epochs these leases can ALL be extended by.
 *
 * The ceiling is per-blob — a lease may not end more than `maxAhead` epochs past the current one —
 * so the blob that already reaches furthest into the future is the binding one. 0 is a real
 * answer ("already paid as far ahead as the network allows"), not a failure.
 */
export function headroom(leases: readonly BlobLease[], current: number, maxAhead: number): number {
  if (leases.length === 0) return 0;
  const furthest = Math.max(...leases.map((l) => l.endEpoch));
  return Math.max(0, current + maxAhead - furthest);
}

/**
 * How many epochs to buy: what was asked for, or the default, checked against both ceilings.
 *
 * ⛔ IT REFUSES RATHER THAN CLAMPS. Quietly buying fewer epochs than somebody asked for spends
 *    their money on something they did not ask for, and quietly buying more spends more of it.
 *    Each refusal names the ceiling that produced it, because the two have different remedies:
 *    the network's is a wait, the server's is a shorter extension repeated later.
 */
export function chooseEpochs(asked: string | number | undefined, available: number): number {
  if (available <= 0) {
    throw new NmtsError("This file's storage is already paid as far ahead as the network allows.", {
      exitCode: 4,
      nextStep:
        "Nothing was signed and nothing was charged. The storage network refuses a lease that " +
        "ends further ahead than its own ceiling; extending again becomes possible as the " +
        "network's epoch moves forward.",
    });
  }
  const epochs = asked === undefined ? DEFAULT_EXTEND_EPOCHS : parseEpochs(asked);
  if (epochs > available) {
    throw new NmtsError(
      `The storage network will sell at most ${available} more epoch${available === 1 ? "" : "s"} on this file.`,
      {
        exitCode: 4,
        nextStep:
          `Nothing was signed and nothing was charged. A lease may not end further ahead than the ` +
          `network's own ceiling. Ask for ${available} or fewer: \`${BINARY_NAME} extend --epochs ${available}\`.`,
      },
    );
  }
  if (epochs > MAX_RECORDABLE_EPOCHS) {
    throw new NmtsError(`This tool extends by at most ${MAX_RECORDABLE_EPOCHS} epochs at a time.`, {
      exitCode: 4,
      nextStep:
        `Nothing was signed and nothing was charged. The NMTS server refuses to record a longer ` +
        `one, so the storage would really be extended and the drive would go on showing the old ` +
        `date. Extend by ${MAX_RECORDABLE_EPOCHS} or fewer, more than once if you need to.`,
    });
  }
  return epochs;
}

/** A whole positive number of epochs, or the one refusal for anything else. */
function parseEpochs(asked: string | number): number {
  const epochs = typeof asked === "number" ? asked : Number(asked.trim());
  if (!Number.isSafeInteger(epochs) || epochs <= 0) {
    throw new NmtsError(`An extension is a whole number of epochs: ${String(asked)}.`, {
      exitCode: 2,
      nextStep:
        `Nothing was signed and nothing was charged. \`--epochs 4\` buys four more of the storage ` +
        `network's epochs — one day each on testnet, fourteen on mainnet.`,
    });
  }
  return epochs;
}

/** Where the storage network's clock stands, and how far ahead it will sell. */
export interface ExtendWindow {
  clock: EpochClock;
  /**
   * How many epochs past the current one a lease may reach — the protocol's own ceiling, read from
   * the chain. ⛔ Never a constant: too high and the last length offered is refused on-chain after
   * the transaction is signed; too low and this tool refuses to buy what the network would sell.
   */
  maxAhead: number;
}

/**
 * The chain, as this command needs it to READ.
 *
 * ⛔ A SEAM, NOT AN OPTION. No flag reaches it and nothing on a command line can supply one. It
 *    exists because the alternative is a test that talks to a live storage network — which cannot
 *    run offline, answers differently every fortnight, and can never be asked to be at its own
 *    ceiling on demand, which is most of what this command has to get right.
 */
export interface ExtendReads {
  /** The clock and the ceiling, or null when the network could not be read at all. */
  readWindow(): Promise<ExtendWindow | null>;
  /** Each blob's own lease, in the order asked for. Rejects rather than guessing. */
  readLeases(objectIds: readonly string[]): Promise<BlobLease[]>;
  /** What extending all of them by `epochs` costs, in FROST (WAL base units). */
  quote(leases: readonly BlobLease[], epochs: number): Promise<bigint>;
}

/**
 * The one thing in this tool that signs.
 *
 * ⛔ IT IS A SEPARATE SEAM FROM THE READS ON PURPOSE. A test can then prove what matters most
 *    about this command — that `--dry-run` and a missing agreement both stop BEFORE this function
 *    is reached — by handing it one that records being called and fails the test if it ever is.
 *    Folded into `ExtendReads`, "did it sign" would be a question about which method ran.
 *
 * Returns the transaction digest, which is what the server records as the replay guard.
 */
export type SignExtension = (input: {
  network: string;
  /** ⛔ The account code. It never leaves this machine: it derives the wallet and nothing else. */
  code: string;
  objectIds: readonly string[];
  epochs: number;
}) => Promise<string>;
