import type { ExtendWindow } from "./extend-plan.ts";
import type { Network } from "./network.ts";
import type { PaddingRule } from "./shared/lib/crypto/size-padding.ts";
import { type PartQuote } from "./upload-wallet-plan.ts";
/**
 * The gas one part's two transactions used, measured on testnet (2026-11-10, this unit's runs).
 *
 * ⛔ COMPUTATION IS IN GAS UNITS, STORAGE IN MIST. Sui charges computation as units × the reference
 *    gas price, which each network sets per epoch, and storage at a fixed price per byte; the
 *    rebate is what deleting the objects later gives back. Keeping the units lets the estimate
 *    follow the network's price instead of freezing testnet's.
 */
export declare const MEASURED_GAS: {
    readonly source: string;
    readonly register: {
        readonly computationUnits: 1000n;
        readonly storageMist: 115732800n;
        readonly rebateMist: 112757523n;
    };
    readonly certify: {
        readonly computationUnits: 1000n;
        readonly storageMist: 2006400n;
        readonly rebateMist: 1975802n;
    };
};
/** What the quote asks for. */
export interface UploadQuoteAsk {
    /** The file's size in bytes, before sealing. */
    bytes: number;
    /** Storage-network epochs. Default 2, the term `put` buys. */
    epochs?: number | undefined;
    /** How the last part is padded. Default `padme`, a new account's rule. */
    padding?: PaddingRule | undefined;
    /** Bytes of the file per part. Default 64 MiB, `put`'s. */
    partSize?: number | undefined;
}
/** One part, priced. Base units throughout, as decimal strings so JSON carries them whole. */
export interface QuotedPart {
    /** Bytes the storage network holds for this part, sealing and padding included. */
    sealedBytes: number;
    /**
     * What the part occupies once the network has encoded it — the size a storage resource must
     * have to hold it (`buyStorage({ sizeBytes })`, `put(…, { storage: id })`). ⚠ Far above
     * `sealedBytes` for a small part: the encoding carries metadata for every shard.
     */
    encodedBytes: number;
    storageFrost: string;
    writeFrost: string;
    tipMist: string;
}
/** The answer. */
export interface UploadQuote {
    network: Network;
    bytes: number;
    epochs: number;
    /** The epoch the storage would end at if it were bought now. */
    endEpoch: number;
    parts: QuotedPart[];
    sealedBytes: number;
    /** The parts' encoded sizes added up: what one resource holding the whole upload must have. */
    encodedBytes: number;
    /** WAL for the storage and the write, in FROST. */
    walFrost: string;
    /** SUI for the relay's tip, in MIST. */
    tipMist: string;
    /** SUI for the chain fees of every part's two transactions, in MIST. ⚠ An estimate — see `gasSource`. */
    gasEstimateMist: string;
    /** Where `gasEstimateMist` came from. */
    gasSource: string;
    /** The relay the tip is for. Another relay charges its own tip; the storage nodes charge none. */
    relay: string;
    /**
     * What the same upload costs on the credit rail. ⛔ NULL WHEN `epochs` IS NOT THE CREDIT TERM:
     * a credit buys one mebibyte for exactly 2 epochs, and the credit rail sells no other term.
     */
    credits: number | null;
}
/** The chain, as the quote reads it. ⚠ A seam — a test hands in a table. */
export interface UploadQuoteReads {
    readWindow(): Promise<ExtendWindow | null>;
    quoteParts(sealedLens: readonly number[], epochs: number): Promise<PartQuote[]>;
    /** The network's reference gas price now, in MIST per unit, or null when it could not be read. */
    referenceGasPrice(): Promise<bigint | null>;
    /** What `sealedLen` bytes occupy once encoded — the chain's own function, asked with no sender. */
    encodedLength(sealedLen: number): Promise<number>;
}
/** The measured gas of `parts` parts at `price` MIST per unit. */
export declare function gasEstimate(parts: number, price: bigint): bigint;
/** The price of an upload of `ask.bytes` for `ask.epochs`, with nothing opened and nothing signed. */
export declare function quoteUpload(network: Network, ask: UploadQuoteAsk, seams?: {
    reads?: UploadQuoteReads;
    relay?: string;
}): Promise<UploadQuote>;
