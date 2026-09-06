import { type Network } from "../network.ts";
import type { SendReads } from "../wallet-send-chain.ts";
import type { SignTransfer } from "../wallet-sign.ts";
export interface WalletSendOptions {
    server?: string | undefined;
    network?: string | undefined;
    json?: boolean;
    write?: (line: string) => void;
    /** Actually send. Without it the review is printed and nothing is signed. */
    yes?: boolean;
    /** Print the review and stop, even with --yes. */
    dryRun?: boolean;
    /** A ceiling on the fee, in SUI ("0.01"). Clamped to the usable range, never refused. */
    feeCap?: string | undefined;
    /** The instant to measure the wallet agreement against. */
    now?: number;
    /** ⚠ A SEAM, NOT AN OPTION — no flag reaches it. */
    readChain?: (network: Network) => SendReads | Promise<SendReads>;
    /** ⛔ SEPARATE FROM THE READS so a test can prove the review stops before this. */
    sign?: SignTransfer;
}
export declare function walletSend(operands: readonly string[], options?: WalletSendOptions): Promise<number>;
