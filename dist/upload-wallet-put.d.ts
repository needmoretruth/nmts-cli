import type { OnCollision } from "./collision.ts";
import { type CryptoGlue } from "./crypto.ts";
import type { Network } from "./network.ts";
import type { PaddingRule } from "./shared/lib/crypto/size-padding.ts";
import { type FileUploadStep, type PlaintextSource } from "./upload-file.ts";
import { type StorageChoice, type UploadBudget, type WalletUploadReads } from "./upload-wallet-plan.ts";
import type { BlobProtocol, UploadApi } from "./upload-wire.ts";
import type { Spend } from "./wallet-grant.ts";
import type { SignBlobCertify, SignBlobRegister } from "./wallet-sign.ts";
/** The account this upload belongs to, and how it seals. */
export interface WalletPutContext {
    /** ⛔ The NMTS key. It seals the file AND derives the wallet that pays. It is never written down. */
    code: string;
    apiKey: string;
    server: string;
    network: Network;
    accountId: string;
    crypt: CryptoGlue;
    /** How much of the file goes into one part. */
    partSize: number;
    /** The rounding rule from the account's sealed list — it changes the stored size, so the price. */
    rule: PaddingRule;
    /** What to do about a name already in use. Absent = the machine's setting, as `addEntry` reads it. */
    onCollision?: OnCollision | undefined;
    /**
     * Which of this key's wallets pays, by index (0 = the first one).
     *
     * ⛔ THE CALLER RESOLVES IT, BEFORE ANYTHING IS PRICED. It is the account's own number, kept in
     *    the sealed file list (`wallet-pay-index.ts`), and a library that guessed at it here would
     *    price one address and sign with another.
     */
    wallet: number;
}
/** One file and where it goes — already resolved, because a library resolves nothing by asking. */
export interface WalletPutFile {
    source: PlaintextSource;
    name: string;
    parentId: string | null;
    /** The destination AS TYPED — part of the reservation key, so both runs of a resume agree. */
    destination: string;
}
/** The chain, the signatures, the wire and the four things a caller may be told. */
export interface WalletPutSeams {
    /** How many of the storage network's epochs to buy. Default `DEFAULT_UPLOAD_EPOCHS`. */
    epochs?: string | number | undefined;
    /** `fit`, `whole`, or a held resource's object id. Absent = buy new storage. */
    storage?: string | undefined;
    /** Stop at the review. Nothing is sealed, signed or sent, and no signer is even loaded. */
    dryRun?: boolean | undefined;
    /** ⚠ A SEAM, NOT AN OPTION — what the chain is asked. */
    readChain?: ((network: Network, relayUrl: string) => WalletUploadReads | Promise<WalletUploadReads>) | undefined;
    /** ⛔ SEPARATE FROM THE READS so a caller can prove the review stops before this. */
    sign?: {
        register: SignBlobRegister;
        certify: SignBlobCertify;
    } | undefined;
    /** ⚠ SEAMS, NOT OPTIONS — the storage-network protocol and the server calls. */
    protocol?: ((network: Network, bodyBytes: number, onSent: (sent: number, total: number) => void) => BlobProtocol & {
        relayUrl: string;
    }) | undefined;
    api?: UploadApi | undefined;
    /** Told as sealed bytes leave for the relay. */
    onProgress?: ((sent: number, total: number) => void) | undefined;
    /** Told about each step as it starts. */
    onStep?: ((step: FileUploadStep) => void) | undefined;
    /** Told the numbers the moment they are known — before the dry run returns and before a refusal. */
    onReview?: ((review: WalletPutReview) => void) | undefined;
    /** ⛔ THE GATE. Throwing here stops the upload with nothing signed. See the module header. */
    agree?: ((review: WalletPutReview) => void) | undefined;
    /** Told what left the wallet, after each signature. */
    onSpend?: ((spend: Spend) => void) | undefined;
}
/** What this upload would buy, in the order somebody deciding needs it. Base units throughout. */
export interface WalletPutReview {
    name: string;
    /** Plaintext bytes. */
    bytes: number;
    /** Bytes the storage network holds, padding and sealing included. */
    sealedBytes: number;
    parts: number;
    epochs: number;
    /** The term in days, read from the network's own clock. */
    days: string;
    /** The epoch the storage runs to. */
    endEpoch: number;
    /** The relay's tip over every part, in MIST. Paid inside the register signatures. */
    tipMist: bigint;
    /** Where the storage comes from. */
    storage: StorageChoice;
    /** Free storage resources the wallet holds when none was asked for; null when unreadable. */
    heldResources: number | null;
    /** The wallet against the price: what is needed, what is held, and the shortfall if there is one. */
    budget: UploadBudget;
}
/** A dry run's answer, or a finished upload's. The review is in both, so both report one price. */
export type WalletPutOutcome = {
    kind: "review";
    review: WalletPutReview;
} | {
    kind: "uploaded";
    review: WalletPutReview;
    itemId: string;
    /** The name it got — numbered if the one asked for was taken. */
    savedAs: string;
    /** The id of the file this one displaced into the trash, when the machine overwrites. */
    replaced: string | null;
    /** The file-list version this write produced. */
    fileListVersion: number;
    /** True when every part was already signed for by an earlier run: this call spent nothing. */
    resumed: boolean;
};
/**
 * Price, agree, sign, upload and record ONE file, paid from the wallet the NMTS key derives.
 *
 * ⛔ THE SIGNING MODULE IS LOADED ONLY AFTER `agree` HAS RETURNED. A dry run and a refusal never
 *    bring the code that can spend into memory.
 */
export declare function walletPut(ctx: WalletPutContext, file: WalletPutFile, seams?: WalletPutSeams): Promise<WalletPutOutcome>;
