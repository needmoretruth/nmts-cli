// What a wallet holds in storage — the free resources, ordered and judged, without a screen.
//
// ⛔ EVERYTHING HERE IS A READ. What the storage network sells is size and time, not a file;
//    deleting a file from the network returns the remaining time to the wallet that bought it, and
//    that is what this lists. Splitting, joining and handing one over are next door in
//    `reshape.ts`, because each of them signs.
//
// ⛔ "NONE" AND "COULD NOT READ" ARE DIFFERENT ANSWERS, and this file is where that is kept: the
//    reader throws rather than answering an empty list, and `readOrRefuse` turns that into one
//    refusal with the chain's own cause in it. Flattening the two would draw a wallet full of
//    storage as a wallet with none, on the screen somebody decides what to buy from.
//
// ⛔ AND THE JUDGEMENT IS THE BROWSER'S, not a second copy of it: `shared/lib/storage-control/plan.ts`
//    is copied byte for byte from the browser and says what "usable" means and in what order these
//    are shown. Nothing here reaches for `node:`.

import { NmtsError } from "../errors.ts";
import type { Network } from "../network.ts";
import type { StorageResource } from "../shared/lib/storage-control/chain.ts";
import { statusOf, totalUsableBytes, usableFirst } from "../shared/lib/storage-control/plan.ts";
import type { StorageHints } from "./hints.ts";

/** What the chain said: the resources, and which epoch it is (null when the clock could not be read). */
export interface StorageRead {
  items: readonly StorageResource[];
  currentEpoch: number | null;
}

/** Where a resource stands against the current epoch. */
export type StorageStatus = "lapsed" | "notYet" | "usable";

/** One resource, with where it stands. */
export interface StorageItem extends StorageResource {
  /**
   * ⛔ NULL IS "THE EPOCH COULD NOT BE READ", never "lapsed". Which epoch the network is in is a
   *    fact only the chain has, and guessing it would mark a resource somebody paid for as over.
   */
  status: StorageStatus | null;
}

/** One wallet's storage, as anything asking about it needs it. */
export interface StorageListing {
  address: string;
  network: Network;
  currentEpoch: number | null;
  /** Usable first, then largest, then furthest ahead — left as read when there is no epoch. */
  items: readonly StorageItem[];
  /** The usable sizes added up — null when the epoch could not be read. */
  usableBytes: number | null;
}

/**
 * How the resources are read.
 *
 * ⚠ A SEAM, NOT AN OPTION — no flag and no caller argument reaches it. A test that talked to a live
 *   storage network could not run offline and could never be asked to hold a lapsed resource.
 */
export type ReadWalletStorage = (network: Network, address: string) => Promise<StorageRead>;

/** Every free storage resource one address holds, in the order a person reads them. */
export async function listStorage(
  input: { network: Network; address: string },
  read: ReadWalletStorage = defaultRead,
  hints: StorageHints = {},
): Promise<StorageListing> {
  const got = await readOrRefuse(() => read(input.network, input.address), hints);
  const epoch = got.currentEpoch;
  const ordered = epoch === null ? [...got.items] : usableFirst(got.items, epoch);
  return {
    address: input.address,
    network: input.network,
    currentEpoch: epoch,
    items: ordered.map((r) => ({ ...r, status: epoch === null ? null : statusOf(r, epoch) })),
    usableBytes: epoch === null ? null : totalUsableBytes(ordered, epoch),
  };
}

/**
 * The one refusal for a chain that did not answer.
 *
 * ⛔ IT IS NOT AN EMPTY LIST. Holding no resource is normal; failing to read is a reason to look
 *    again, and the chain's own words are carried so that whoever reads it knows which it was.
 */
export async function readOrRefuse(
  read: () => Promise<StorageRead>,
  hints: StorageHints = {},
): Promise<StorageRead> {
  try {
    return await read();
  } catch (error) {
    const said = hints.cannotRead ?? "That is not the same as holding none, and nothing was signed.";
    throw new NmtsError("The storage resources could not be read from the chain.", {
      exitCode: 1,
      nextStep: `${said} Cause: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

/** The real read. Imported only when no seam was supplied — it loads the storage network's client. */
async function defaultRead(network: Network, address: string): Promise<StorageRead> {
  return (await import("../wallet-storage-chain.ts")).readWalletStorage(network, address);
}

/**
 * Bytes as a person reads them: binary units, two decimals, whole bytes below a KiB.
 *
 * ⚠ HERE RATHER THAN BESIDE THE SCREEN THAT PRINTS THEM, because the refusals in `reshape.ts` name
 *   a resource's size too, and a refusal that said `4294967296` about a resource a listing calls
 *   `4.00 GiB` would be two spellings of one number in front of the same person.
 */
export function formatBytes(bytes: number): string {
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unit = "B";
  for (const next of units) {
    if (value < 1024) break;
    value /= 1024;
    unit = next;
  }
  return unit === "B" ? `${bytes} B` : `${value.toFixed(2)} ${unit}`;
}
