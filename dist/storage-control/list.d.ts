import type { Network } from "../network.ts";
import type { StorageResource } from "../shared/lib/storage-control/chain.ts";
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
export declare function listStorage(input: {
    network: Network;
    address: string;
}, read?: ReadWalletStorage, hints?: StorageHints): Promise<StorageListing>;
/**
 * The one refusal for a chain that did not answer.
 *
 * ⛔ IT IS NOT AN EMPTY LIST. Holding no resource is normal; failing to read is a reason to look
 *    again, and the chain's own words are carried so that whoever reads it knows which it was.
 */
export declare function readOrRefuse(read: () => Promise<StorageRead>, hints?: StorageHints): Promise<StorageRead>;
/**
 * Bytes as a person reads them: binary units, two decimals, whole bytes below a KiB.
 *
 * ⚠ HERE RATHER THAN BESIDE THE SCREEN THAT PRINTS THEM, because the refusals in `reshape.ts` name
 *   a resource's size too, and a refusal that said `4294967296` about a resource a listing calls
 *   `4.00 GiB` would be two spellings of one number in front of the same person.
 */
export declare function formatBytes(bytes: number): string;
