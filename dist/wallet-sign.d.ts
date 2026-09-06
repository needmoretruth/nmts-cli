import type { SignExtension } from "./extend-plan.ts";
import { type TransferShape } from "./wallet-send-chain.ts";
import { type StorageOpShape } from "./storage-control-chain.ts";
import { type SwapShape } from "./wallet-swap-chain.ts";
import type { Network } from "./network.ts";
import type { RegisterShape } from "./upload-wallet-plan.ts";
import type { Certificate } from "./upload-wire.ts";
/**
 * The address this tool would sign as.
 *
 * ⛔ IT EXISTS TO BE HELD AGAINST `walletAddress`. That function is what `nmts wallet address`
 *    prints and what somebody funds; this one is what a transaction would actually be signed by.
 *    Nothing else in this package proves the two are the same wallet, and the failure if they ever
 *    part is silent — a signature from an address with nothing in it, or worse, money sent to an
 *    address that signs nothing. A test compares them, offline, for free.
 */
export declare function signerAddress(code: string): Promise<string>;
/**
 * Extend every listed blob by `epochs`, in ONE transaction, signed by the account's own wallet.
 *
 * ONE SIGNATURE FOR ALL OF IT: `extendBlob` returns a transaction fragment, so every blob a file
 * sits on goes into the same transaction. A multi-part file is one payment and one gas fee, not
 * five — and a partial extension would buy nothing, because one expired blob is enough to make the
 * file unreadable.
 *
 * ⛔ THE IDS ARE DE-DUPLICATED. Naming the same blob twice pays for the same epochs twice.
 *
 * ⚠ A FAILURE HERE IS NOT PROOF THAT NOTHING HAPPENED. A refusal from the node, a timeout, a
 *   connection that dropped after the bytes went out — none of them say whether the transaction
 *   was executed. The caller re-reads the chain rather than offering a second attempt against
 *   numbers it read before.
 */
export declare const signExtension: SignExtension;
/**
 * Send SUI or WAL to one address, in ONE transaction, signed by the account's own wallet.
 *
 * ⛔ THE TRANSACTION IS BUILT BY `wallet-send-chain.ts`, the same builder the fee was measured
 *    with, so what is signed is what was priced. The destination is whatever the caller validated
 *    (`send-rules.ts`) — nothing here checks it again, and nothing can take it back.
 *
 * ⚠ A FAILURE HERE IS NOT PROOF THAT NOTHING HAPPENED — the same words as the extension above.
 */
export declare const signTransfer: SignTransfer;
/**
 * Sign one short message with the account's own wallet. NOT a transaction: nothing moves.
 *
 * ⛔ THE MESSAGE IS THE CALLER'S, WHOLE AND UNCHANGED — the server rebuilds the same bytes from
 *    the fields it was sent, so a byte added here would invalidate every signature this tool
 *    makes. `signPersonalMessage` and not `sign`: that intent is the domain separator which stops
 *    signed text from ever being read as a transaction this wallet authorised.
 */
export declare const signMessage: SignMessage;
/** The seam `commands/wallet-hall.ts` signs through. Returns the base64 signature, nothing else. */
export type SignMessage = (input: {
    /** ⛔ The NMTS key. It never leaves this machine: it derives the wallet and nothing else. */
    code: string;
    message: string;
}) => Promise<string>;
/** The seam `commands/wallet-send.ts` signs through. Returns the transaction digest. */
export type SignTransfer = (input: {
    network: string;
    /** ⛔ The NMTS key. It never leaves this machine: it derives the wallet and nothing else. */
    code: string;
    shape: TransferShape;
}) => Promise<string>;
/**
 * Swap SUI for WAL or WAL for SUI on the named venue, in ONE transaction, signed by the account's
 * own wallet. Every output goes back to the signer — DeepBook's three coins are sent there by this
 * transaction, Bluefin's by its own entry function — so there is no destination to get wrong.
 *
 * ⛔ THE TRANSACTION IS BUILT BY `wallet-swap-chain.ts`, the same builder the fee was measured with,
 *    on the same Bluefin package the quote used. The minimum-out in the shape is what protects the
 *    person: the chain refuses a swap that would give less, and the fee for that refusal is spent.
 *
 * ⚠ A FAILURE HERE IS NOT PROOF THAT NOTHING HAPPENED — the same words as the extension above.
 */
export declare const signSwap: SignSwap;
/** The seam `commands/wallet-swap.ts` signs through. Returns the transaction digest. */
export type SignSwap = (input: {
    network: Network;
    /** ⛔ The NMTS key. It never leaves this machine: it derives the wallet and nothing else. */
    code: string;
    shape: SwapShape;
}) => Promise<string>;
/**
 * Register ONE part's blob, signed by the account's own wallet: the relay's tip, then the storage
 * — bought for `epochs`, or a resource the wallet already holds, cut to fit first if asked.
 *
 * ⛔ THE TRANSACTION IS BUILT BY `upload-wallet-chain.ts`, the same builder the fee was measured
 *    with, so what is signed is what was priced. What comes back is what the commit and the resume
 *    need: the digest the relay checks its tip in, the blob object, and the epoch the chain says
 *    the storage ends at.
 *
 * ⚠ A FAILURE HERE IS NOT PROOF THAT NOTHING HAPPENED — the same words as the extension above.
 *   The caller keeps its record and re-reads it rather than registering again.
 */
export declare const signBlobRegister: SignBlobRegister;
/** Certify ONE registered part from the relay's certificate. Gas only; nothing else leaves the wallet. */
export declare const signBlobCertify: SignBlobCertify;
/** The seam the wallet rail registers through. */
export type SignBlobRegister = (input: {
    network: Network;
    code: string;
    relayUrl: string;
} & RegisterShape) => Promise<{
    digest: string;
    blobObjectId: string;
    endEpoch: number;
}>;
/** The seam the wallet rail certifies through. Returns the transaction digest. */
export type SignBlobCertify = (input: {
    network: Network;
    code: string;
    relayUrl: string;
    blobId: string;
    blobObjectId: string;
    certificate: Certificate;
}) => Promise<string>;
/** How a storage-resource operation is signed; the shape carries what the review priced. */
export type SignStorageOp = (input: {
    network: Network;
    code: string;
    shape: StorageOpShape;
    walrusPackageId: string;
}) => Promise<string>;
/**
 * Cut, join or hand over a storage resource, in ONE transaction, signed by the account's own wallet.
 *
 * ⛔ THE TRANSACTION IS BUILT BY `storage-control-chain.ts`, the same builder the dry run priced,
 *    so what is signed is what was reviewed. A failed execution still has a digest and still
 *    spent its gas, so the status is read and a failure is said as one.
 */
export declare const signStorageOp: SignStorageOp;
