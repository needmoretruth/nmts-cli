import { type OnCollision } from "../collision.ts";
import { type CryptoGlue } from "../crypto.ts";
import { type Network } from "../network.ts";
import { Progress } from "../progress.ts";
import type { PaddingRule } from "../shared/lib/crypto/size-padding.ts";
import type { AccountSettings } from "../shared/lib/drive/manifest-settings.ts";
import type { StandingTipInput } from "../standing-tip.ts";
import { type WalletUploadReads } from "../upload-wallet-plan.ts";
import type { BlobProtocol, UploadApi } from "../upload-wire.ts";
import type { SignBlobCertify, SignBlobRegister } from "../wallet-sign.ts";
import { type PutOptions } from "./put.ts";
/** What paying from the wallet adds to an upload command. */
export interface WalletPayOptions {
    /** How many of the storage network's epochs to buy. Default `DEFAULT_UPLOAD_EPOCHS`. */
    epochs?: string | number | undefined;
    /** `fit`, `whole`, or a held resource's object id. Absent = buy new storage. */
    storage?: string | undefined;
    /** The instant the wallet agreement is measured against. */
    now?: number;
    /** ⚠ A SEAM, NOT AN OPTION — no flag reaches it. */
    readChain?: (network: Network, relayUrl: string) => WalletUploadReads | Promise<WalletUploadReads>;
    /** ⛔ SEPARATE FROM THE READS so a test can prove the review stops before this. */
    sign?: {
        register: SignBlobRegister;
        certify: SignBlobCertify;
    };
    /** ⚠ SEAMS, NOT OPTIONS — the standing tip's own read and signature. No flag reaches them. */
    tip?: Pick<StandingTipInput, "readDonation" | "sign">;
    /** The storage-network protocol and the server calls — seams for the tests, as `upload.ts` has. */
    protocol?: (network: Network, bodyBytes: number, onSent: (sent: number, total: number) => void) => BlobProtocol & {
        relayUrl: string;
    };
    api?: UploadApi;
}
export type PutWalletOptions = PutOptions & WalletPayOptions;
/** One local file and where it goes — what `put` and `push` both hand in. */
export interface WalletUploadFile {
    localPath: string;
    size: number;
    name: string;
    parentId: string | null;
    /** The destination AS TYPED — part of the reservation key. */
    destination: string;
}
export interface WalletUploadContext {
    code: string;
    apiKey: string;
    server: string;
    network: Network;
    accountId: string;
    crypt: CryptoGlue;
    partSize: number;
    rule: PaddingRule;
    onCollision?: OnCollision | undefined;
    /** The sealed list's account settings, as read for this run — the standing tip lives in them. */
    settings?: AccountSettings | undefined;
    progress: Progress;
    say: (line: string) => void;
    json: boolean;
}
export declare function putWithWallet(target: string | undefined, options: PutWalletOptions): Promise<number>;
/**
 * Review, agree, upload and record ONE file. Null when `--dry-run` stopped at the review.
 *
 * ⛔ THE SIGNING MODULE IS LOADED AFTER THE AGREEMENT, and only then — a dry run and a refusal
 *    never bring the code that can spend into memory.
 */
export declare function uploadOneWithWallet(ctx: WalletUploadContext, file: WalletUploadFile, options: WalletPayOptions & {
    dryRun?: boolean | undefined;
}): Promise<{
    itemId: string;
    savedAs: string;
    replaced: string | null;
    seq: number;
    resumed: boolean;
    facts: Record<string, unknown>;
} | null>;
