import type { StorageOpShape } from "./storage-control-chain.ts";
import type { SwapShape } from "./wallet-swap-chain.ts";
import type { TransferShape } from "./wallet-send-chain.ts";
import type { RegisterShape } from "./upload-wallet-plan.ts";
import type { Certificate } from "./upload-wire.ts";
import type { Network } from "./network.ts";
/** The seam `commands/wallet-hall.ts` signs through. Returns the base64 signature, nothing else. */
export type SignMessage = (input: {
    /** ⛔ The NMTS key. It never leaves this machine: it derives the wallet and nothing else. */
    code: string;
    /**
     * Which of this key's wallets proves the name.
     *
     * ⛔ IT IS THE PAYING WALLET BECAUSE THAT IS THE WALLET THE GIFT CAME FROM. A hall entry is an
     *    address, and `wallet donate` sends from the account's own number; signing with any other
     *    wallet would offer the server a name for an address that has never given anything.
     */
    wallet: number;
    message: string;
}) => Promise<string>;
/** The seam `commands/wallet-send.ts` signs through. Returns the transaction digest. */
export type SignTransfer = (input: {
    network: string;
    /** ⛔ The NMTS key. It never leaves this machine: it derives the wallet and nothing else. */
    code: string;
    /** Which of this key's wallets pays — the account's own number (`wallet-pay-index.ts`). */
    wallet: number;
    shape: TransferShape;
}) => Promise<string>;
/** The seam `commands/wallet-swap.ts` signs through. Returns the transaction digest. */
export type SignSwap = (input: {
    network: Network;
    /** ⛔ The NMTS key. It never leaves this machine: it derives the wallet and nothing else. */
    code: string;
    /** Which of this key's wallets swaps — the account's own number (`wallet-pay-index.ts`). */
    wallet: number;
    shape: SwapShape;
}) => Promise<string>;
/** The seam the wallet rail registers through. */
export type SignBlobRegister = (input: {
    network: Network;
    code: string;
    wallet: number;
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
    /** The same wallet that registered the part — it is the one that owns the blob object. */
    wallet: number;
    relayUrl: string;
    blobId: string;
    blobObjectId: string;
    certificate: Certificate;
}) => Promise<string>;
/** How a storage-resource operation is signed; the shape carries what the review priced. */
export type SignStorageOp = (input: {
    network: Network;
    code: string;
    /** Which of this key's wallets holds the resource — the account's own number. */
    wallet: number;
    shape: StorageOpShape;
    walrusPackageId: string;
}) => Promise<string>;
