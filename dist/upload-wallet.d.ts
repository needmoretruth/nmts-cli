import type { Network } from "./network.ts";
import type { PartQuote, StorageChoice } from "./upload-wallet-plan.ts";
import { type PaidPart, type UploadInput } from "./upload-wire.ts";
import type { Spend } from "./wallet-grant.ts";
import type { SignBlobCertify, SignBlobRegister } from "./wallet-sign.ts";
export interface WalletRailContext {
    network: Network;
    /** ⛔ The account code. Held for the signatures and never written anywhere. */
    code: string;
    relayUrl: string;
    epochs: number;
    /** Where the storage comes from. A held resource serves one blob, so it applies to a one-part file. */
    storage: StorageChoice;
    /** What each part was quoted, in part order — what the grant ledger is told after each signature. */
    quotes: readonly PartQuote[];
    /** The measured register fee, added to the ledger with the tip; null adds the tip alone. */
    feeMist: bigint | null;
    signRegister: SignBlobRegister;
    signCertify: SignBlobCertify;
    /** Told what left the wallet, after each signature. */
    onSpend: (spend: Spend) => void;
}
/** The rail: what `uploadFile` calls once per part. */
export declare function walletRail(ctx: WalletRailContext): (input: UploadInput) => Promise<PaidPart>;
