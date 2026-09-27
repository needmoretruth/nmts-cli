import { type HeavyFile, type HeavyOrderContext, type HeavyOrderOutcome } from "./heavy-upload.ts";
import type { Network } from "./network.ts";
import type { SendReads, TransferShape } from "./wallet-send-chain.ts";
/** What the opened order asks, and what the paying wallet holds against it. */
export interface HeavyWalletQuote {
    orderId: string;
    /** The Sui address that sends the WAL. */
    address: string;
    /** Where the WAL goes. */
    treasury: string;
    walFrost: bigint;
    /** The transfer's measured fee in MIST, or null when it could not be measured. */
    feeMist: bigint | null;
    termDays: number;
}
export interface HeavyWalletInput {
    code: string;
    network: Network;
    /** Which of this key's wallets pays. */
    wallet: number;
    /** 1..=365. */
    termDays: number;
    /** Told the quote as soon as it is known — before the checks, so a refusal follows what was shown. */
    onQuote?: ((quote: HeavyWalletQuote) => void) | undefined;
    /** Asked once the balances cover the quote, before anything is sealed; throwing stops the run. */
    approve?: ((quote: HeavyWalletQuote) => void) | undefined;
    /** Told once the WAL has left. */
    onPaid?: ((spent: {
        walFrost: bigint;
        suiMist: bigint;
    }) => void) | undefined;
    /** ⚠ Seams, not options: the chain's reads and the transfer's signature, for tests. */
    reads?: SendReads | undefined;
    sign?: ((shape: TransferShape) => Promise<string>) | undefined;
}
/** Store `files` in one wallet-paid Heavy order. */
export declare function heavyWalletPut(ctx: HeavyOrderContext, files: readonly HeavyFile[], input: HeavyWalletInput): Promise<HeavyOrderOutcome & {
    quote: HeavyWalletQuote;
}>;
