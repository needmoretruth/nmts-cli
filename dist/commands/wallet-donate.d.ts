import { type Network } from "../network.ts";
import type { SendReads } from "../wallet-send-chain.ts";
import type { SignTransfer } from "../wallet-sign.ts";
/** What `GET /api/donation` says. */
export interface DonationConfig {
    devAddress: string;
    sendEnabled: boolean;
    walEnabled: boolean;
}
export interface WalletDonateOptions {
    server?: string | undefined;
    network?: string | undefined;
    json?: boolean;
    write?: (line: string) => void;
    yes?: boolean;
    dryRun?: boolean;
    feeCap?: string | undefined;
    /** ⚠ SEAMS, NOT OPTIONS — no flag reaches them. */
    readDonation?: (server: string) => Promise<DonationConfig>;
    readChain?: (network: Network) => SendReads | Promise<SendReads>;
    sign?: SignTransfer;
}
/** The four facts and the promise, as the screens say them, in the order a person reads them. */
export declare const GIFT_NOTICES: readonly string[];
export declare function asDonationConfig(value: unknown): DonationConfig;
export declare function walletDonate(operands: readonly string[], options?: WalletDonateOptions): Promise<number>;
