import { type EpochClock } from "./expiry.ts";
import type { BlobProtocol } from "./upload-wire.ts";
/**
 * How long the relay gets for one blob PUT, sized to the body.
 *
 * The SDK's own default is 30 seconds, which a multi-megabyte body cannot finish on an ordinary
 * connection — and a timeout here happens AFTER the storage is paid for.
 */
export declare function relayTimeoutMs(bodyBytes: number): number;
/**
 * Build a protocol client bound to ONE relay, for ONE upload of a known size.
 *
 * `onSent` is called as the request body leaves — that is the honest measure of an upload, and it
 * is the only phase of one that anything can report on.
 */
export declare function createBlobProtocol(network: string, bodyBytes: number, onSent?: (sent: number, total: number) => void): BlobProtocol & {
    relayUrl: string;
};
/**
 * The storage network's current epoch, or `null` when it could not be read.
 *
 * ⚠ ADVISORY ONLY. It becomes the `expiry_epoch` the server records beside the file, which the
 *   chain — not this number — is the authority on. `null` is written as 0, meaning "not recorded",
 *   which is honest; inventing a number would put a date in the drive that nothing stands behind.
 */
export declare function readCurrentEpoch(network: string): Promise<number | null>;
/**
 * The storage network's epoch clock: which epoch, how long one lasts, and when this one began.
 *
 * ⛔ THE EPOCH LENGTH IS READ, NEVER ASSUMED. It is one day on one network and fourteen on the
 *    other, so a constant borrowed from either would turn "fourteen days left" into "196 days
 *    left" on the wrong one — beside a sentence about a file being deleted.
 *
 * ⚠ `startedMs` is usually ABSENT and that is normal, not a failure: the network only carries the
 *   moment an epoch settled while it is not changing epochs. Everything downstream treats its
 *   absence as "the day count is a lower bound", which is the safe direction.
 *
 * `null` means the clock could not be read at all. ⛔ The caller must say so rather than draw a
 * drive with nothing expiring — an unread clock and an account in no danger look identical from
 * the outside and are the opposite of each other.
 */
export declare function readEpochWindow(network: string): Promise<EpochClock | null>;
/**
 * When the current epoch began, or null.
 *
 * ⛔ THE NARROWING ITSELF IS NOT WRITTEN HERE (2026-08-25). It used to be, and it accepted a single
 *    enum case while the network sits in a different one for nearly all of every epoch — so the
 *    anchor was thrown away almost always and this tool reported "N days or more" where it could
 *    have reported a date. The browser had the same bug in its own copy of the same judgement,
 *    which is the point: two narrowings are two answers. It now lives beside the arithmetic that
 *    depends on it, in the file both programs copy from.
 *
 * ⛔ STILL EXPORTED FROM HERE. `extend-chain.ts` reads the same state for a different reason and
 *    imports this name; re-exporting keeps one import path for callers in this package.
 */
export { epochStartedMs } from "./shared/lib/extend/epochs.ts";
