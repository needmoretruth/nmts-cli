import { Transaction } from "@mysten/sui/transactions";
import type { Network } from "./network.ts";
import type { SendCoin } from "./shared/lib/wallet/send-rules.ts";
import { type WalletBalances } from "./wallet.ts";
export interface TransferShape {
    coin: SendCoin;
    amountBaseUnits: bigint;
    /** A full, validated Sui address. */
    destination: string;
    /** The WAL coin type of the network (unused for SUI). */
    walType: string;
    /** A gas ceiling, or undefined to let the SDK set one from its own dry run. */
    gasBudgetMist?: bigint | undefined;
}
export declare function transferTransaction(input: TransferShape & {
    sender: string;
}): Transaction;
/** What `commands/wallet-send.ts` reads before it prints a review. */
export interface SendReads {
    readWallet(address: string): Promise<WalletBalances>;
    /** The fee in MIST measured by dry-running this exact transfer, or null when it could not be. */
    estimateFee(shape: TransferShape, sender: string): Promise<bigint | null>;
}
export declare function sendReads(network: Network): SendReads;
