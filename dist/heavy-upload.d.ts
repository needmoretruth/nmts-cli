import type { CryptoGlue } from "./crypto.ts";
import { commitHeavyItem } from "./heavy-api.ts";
import { type FileSecrets } from "./seal.ts";
import type { HeavyOrderApi } from "./shared/lib/api/types-heavy.ts";
import { type PaddingRule } from "./shared/lib/crypto/size-padding.ts";
import { type HeavyPayment, type HeavyProgress, type HeavyRunDeps, type HeavyRunResult } from "./shared/lib/heavy/order-runner.ts";
import { type PlaintextSource } from "./upload-file.ts";
/** One file of a Heavy upload, and where it goes in the drive. */
export interface HeavyFile {
    source: PlaintextSource;
    name: string;
    parentId: string | null;
    /** The destination as typed — carried back for the caller's own messages. */
    destination: string;
}
/** One part of a Heavy file: where it is in the plaintext, what it seals from, what it seals to. */
export interface HeavyPlanPart {
    partIndex: number;
    offset: number;
    length: number;
    /** The plaintext length the stream declares: the last part padded, and never under 39 bytes. */
    sealFrom: number;
    sealedLen: number;
}
/**
 * How a file is cut for Heavy: 512 MiB parts, the last one padded by the account's own rule —
 * exactly as Standard pads — and raised to the 39 bytes a legal piece needs.
 *
 * ⛔ ONLY THE LAST PART IS PADDED, for the reason `upload-file.ts` gives: a reader recovers where the
 *    padding is from the file's size, and that answer is unique only while every earlier part is full.
 */
export declare function planHeavyFile(size: number, rule: PaddingRule): HeavyPlanPart[];
/** What a credit-paid Heavy upload of these sizes costs: every slot is charged on its own, as the server does —
 *  half the Standard price, rounded up, at least 1 per slot — Heavy credits are priced for people, not at cost. */
export declare function heavyCredits(parts: readonly HeavyPlanPart[]): number;
/** One file, read once for its digest, with its key made and its parts planned. */
export interface PreparedHeavyFile {
    file: HeavyFile;
    plan: HeavyPlanPart[];
    secrets: FileSecrets;
}
/** Read each file once for its content digest, and make its key. ⛔ The caller wipes `secrets.dek`. */
export declare function prepareHeavyFiles(crypt: CryptoGlue, dataKey: Uint8Array, rule: PaddingRule, files: readonly HeavyFile[]): Promise<PreparedHeavyFile[]>;
export declare function wipe(prepared: readonly PreparedHeavyFile[]): void;
/** Seal one part of a prepared file. A fresh stream, so a fresh nonce, every call. */
export declare function sealHeavyPart(crypt: CryptoGlue, prepared: PreparedHeavyFile, part: HeavyPlanPart): Promise<Uint8Array<ArrayBuffer>>;
/** The PieceCID, from the Filecoin tooling's own library — loaded only now, never at start-up. */
export declare function pieceCidOfBytes(bytes: Blob | Uint8Array): Promise<string>;
export interface HeavyOrderContext {
    server: string;
    bearer: string;
    crypt: CryptoGlue;
    /** The account's data key. Borrowed — the caller wipes it. */
    dataKey: Uint8Array;
    rule: PaddingRule;
    onProgress?: ((event: HeavyProgress) => void) | undefined;
    signal?: AbortSignal | undefined;
    /** The key an order was already opened under (to show its price first); absent = a fresh one. */
    idempotencyKey?: string | undefined;
    /** ⚠ Seams, not options: the order routes and the runner's edges, for tests. */
    api?: HeavyOrderApi | undefined;
    deps?: Partial<Omit<HeavyRunDeps, "api" | "seal">> | undefined;
    commit?: typeof commitHeavyItem | undefined;
}
/** One committed Heavy file: what the caller writes into the sealed list. */
export interface HeavyCommitted {
    itemId: string;
    name: string;
    parentId: string | null;
    destination: string;
    plaintextLen: number;
    dekWrapped: string;
    contentHashCt: string;
    sealedBytes: number;
    parts: number;
}
export interface HeavyOrderOutcome {
    run: HeavyRunResult;
    files: HeavyCommitted[];
}
/**
 * Upload these files as ONE Heavy order and commit each of them.
 *
 * ⛔ IT DOES NOT WRITE THE SEALED LIST — the caller does, before anything else, exactly as with
 *    `uploadFile`. A committed file the list does not name is invisible to the person.
 */
export declare function heavyOrderPut(ctx: HeavyOrderContext, files: readonly HeavyFile[], payment: HeavyPayment): Promise<HeavyOrderOutcome>;
