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
    /**
     * `--from <drive path>`: re-upload a file the account's CREDITS paid for, on the wallet's money.
     *
     * ⛔ IT IS A DOWNLOAD, A RE-SEAL AND AN OVERWRITE, not a transfer: no chain call can move the
     *    treasury's storage object to somebody's own wallet (`refill-source.ts`). The new file takes
     *    the old one's name and folder, and the old one goes to the trash.
     */
    from?: string | undefined;
    /** `--wallet N`: which wallet pays, this run only. Absent = the account's own number. */
    wallet?: string | undefined;
    /** The instant the wallet agreement is measured against. */
    now?: number;
    /** ⚠ A SEAM, NOT AN OPTION — no flag reaches it. */
    readChain?: (network: Network, relayUrl: string) => WalletUploadReads | Promise<WalletUploadReads>;
    /** ⛔ SEPARATE FROM THE READS so a test can prove the review stops before this. */
    sign?: {
        register: SignBlobRegister;
        certify: SignBlobCertify;
    };
    /**
     * `--trust-server-tip-address`: let THIS SERVER name where the standing gift goes.
     *
     * ⛔ UNLIKE `tip` BELOW, THIS ONE IS A FLAG. It is off unless somebody typed it, and it belongs
     *    to a server they run themselves — see `standing-tip.ts` for what it costs elsewhere.
     */
    trustServerTipAddress?: boolean;
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
    /** A video's preview picture: the video's item id (`put-thumbnail.ts`). */
    thumbOf?: string | undefined;
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
    /** Which of this key's wallets pays (`wallet-pay-index.ts`). Read from the same list as above. */
    wallet: number;
    /**
     * Does this account ask its uploads to carry the recovery list's storage-network copy?
     *
     * ⛔ IT ONLY CHANGES A SENTENCE IN THE REVIEW, never what is signed or sent — which is why a read
     *    that fails arrives here as `null` instead of stopping an upload (`readNetworkCopy`).
     */
    networkCopy: boolean | null;
    progress: Progress;
    say: (line: string) => void;
    json: boolean;
}
export declare function putWithWallet(target: string | undefined, options: PutWalletOptions): Promise<number>;
/**
 * Review, agree, upload and record ONE file for a person who is watching. Null when `--dry-run`
 * stopped at the review.
 *
 * ⛔ THE AGREEMENT HANDED IN BELOW IS THIS MACHINE'S GRANT, held against the total the review
 *    names. It is the one gate between a program and somebody's wallet, and the reason it is
 *    handed to the library rather than living inside it: a library call has nobody to ask.
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
/**
 * Whether this account asks its uploads to carry the recovery list's copy — for the review's one
 * sentence about it, and for nothing else.
 *
 * ⛔ A FAILED READ IS `null`, NOT A FAILED UPLOAD. What hangs on this is a sentence; a server that
 *    could not answer, or one older than the field, must not cost somebody the upload they asked
 *    for. `--json` skips the read entirely — there is no review to print.
 */
export declare function readNetworkCopy(server: string, apiKey: string): Promise<boolean | null>;
