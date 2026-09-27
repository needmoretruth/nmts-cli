import type { Account } from "viem";
import type { CryptoGlue } from "./crypto.ts";
import { commitHeavyItem } from "./heavy-api.ts";
import { type HeavyCommitted, type HeavyFile } from "./heavy-upload.ts";
import type { Network } from "./network.ts";
import type { PaddingRule } from "./shared/lib/crypto/size-padding.ts";
import { type FilecoinChain } from "./shared/lib/filecoin/providers.ts";
/** Copies one self-paid part may ask for, and the default. */
export declare const SELF_PAY_MAX_COPIES = 12;
export declare const SELF_PAY_DEFAULT_COPIES = 2;
/** `--copies` as typed. Absent = 2. Refused, never clamped. */
export declare function copiesOf(raw: string | number | undefined): number;
/** `--providers 4,9` as registry ids. Absent = the SDK chooses. */
export declare function providersOf(raw: string | readonly (number | bigint)[] | undefined): bigint[] | undefined;
/** Which Filecoin chain this NMTS network pays on — refused where no company is listed. */
export declare function selfPayChain(network: Network): FilecoinChain;
/** The Synapse client for one account on one chain. `account` may be a bare address for reads. */
export declare function synapseFor(account: Account | `0x${string}`, chain: FilecoinChain): Promise<import("@filoz/synapse-sdk").Synapse>;
/** The phases a caller can show, per part. */
export type SelfPayProgress = {
    phase: "sealing" | "uploading" | "stored";
    fileIndex: number;
    partIndex: number;
    parts: number;
} | {
    phase: "sent";
    fileIndex: number;
    partIndex: number;
    parts: number;
    sentBytes: number;
    totalBytes: number;
};
export interface SelfPayContext {
    server: string;
    bearer: string;
    crypt: CryptoGlue;
    /** Borrowed — the caller wipes it. */
    dataKey: Uint8Array;
    rule: PaddingRule;
    network: Network;
    /** The EVM account that pays and signs: this key's own (`evm_key_for`), or a business's. */
    account: Account;
    copies: number;
    providers?: readonly bigint[] | undefined;
    signal?: AbortSignal | undefined;
    onProgress?: ((event: SelfPayProgress) => void) | undefined;
    /** ⚠ Seams, not options: the storage client and the commit, for tests. */
    synapse?: SelfPaySynapse | undefined;
    commit?: typeof commitHeavyItem | undefined;
}
/** The two things this path asks of the Synapse SDK. */
export interface SelfPaySynapse {
    upload(bytes: Uint8Array, options: {
        copies: number;
        providerIds?: bigint[];
        signal?: AbortSignal;
        onProgress?: (sent: number) => void;
    }): Promise<{
        pieceCid: string;
        copies: {
            providerId: bigint;
            dataSetId: bigint;
            pieceId: bigint;
            retrievalUrl: string;
        }[];
    }>;
    /** The Filecoin epoch now, and how many more the deposit lasts at its current rate. */
    runway(): Promise<{
        epoch: bigint;
        runwayInEpochs: bigint;
    }>;
}
/** The real one: the Synapse SDK, over this account on this chain. */
export declare function synapseSelfPay(account: Account, chain: FilecoinChain): Promise<SelfPaySynapse>;
/**
 * The epoch the deposit reaches at the rate the account pays after this upload.
 *
 * ⚠ A RATE OF ZERO HAS NO END (the SDK answers the largest uint256). That only happens when no
 *   piece is being paid for, which after a successful upload it is; the 30-day lockup is written
 *   then, because it is what the storage company is owed whatever the deposit does.
 */
export declare function expiryFrom(runway: {
    epoch: bigint;
    runwayInEpochs: bigint;
}): number;
/** Upload these files from the key's own EVM wallet and commit each one. The caller writes the list. */
export declare function heavySelfPut(ctx: SelfPayContext, files: readonly HeavyFile[]): Promise<{
    files: HeavyCommitted[];
    expiryEpoch: number;
    paidBy: string;
    copies: number[];
}>;
