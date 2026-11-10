import { type RecoveryAccount } from "./recovery.ts";
import { type PlaintextSource } from "./upload-file.ts";
import { RIDE_CEILING_BYTES, type BlobProtocol, type PaidPart, type UploadInput } from "./upload-wire.ts";
export { RIDE_CEILING_BYTES };
export interface RideContext {
    account: RecoveryAccount;
    protocol: BlobProtocol;
    /** Said once per skipped or failed copy. The upload goes on either way. */
    onProblem?: ((message: string) => void) | undefined;
}
/** The one part a ride is planned for, before anything is sealed. */
export interface RideShape {
    /** The part's record key, as `uploadFile` files it. */
    partKey: string;
    /** Its sealed length, as `planAndPrice` works it out. */
    sealedLen: number;
    name: string;
    parentId: string | null;
    size: number;
    streamPlaintextLen: number;
}
export interface RecoveryRide {
    /**
     * Before the quote: the length the storage is bought for when the list rides — a fresh quilt, or
     * the quilt a first run stored — or null when the file goes up alone. Never throws.
     */
    plan(shape: RideShape): Promise<number | null>;
    /** The rail, wrapped, for what `plan` decided. */
    wrap(rail: (input: UploadInput) => Promise<PaidPart>): (input: UploadInput) => Promise<PaidPart>;
    /**
     * After the commit: tell the server which quilt holds the newest list. Never throws. Answers the
     * number of the list that rode, or null when none did.
     */
    record(): Promise<number | null>;
}
/** The patch id an aggregator reads one patch by: the quilt id, then version 1 and the two indices. */
export declare function quiltPatchId(quiltId: string, startIndex: number, endIndex: number): string;
/** Wrap a wallet rail so that, with the copy switched on, the recovery list rides in the same quilt. */
export declare function rideRecoveryList(ctx: RideContext): RecoveryRide;
/**
 * The ride for one wallet upload, planned for its one part: the ride, and the length to price.
 *
 * ⚠ THE PROOF IS `authSecret` — what every sign-in sends and the proof header carries. The caller
 *   already holds the code for the upload itself, so building it here asks nothing new of anybody.
 *
 * ⚠ THE FILE IS READ ONCE MORE, to find its records (a resume prices what the first run stored). A
 *   ride is a file of one part under 64 MiB, so nothing larger is read twice.
 */
export declare function planWalletRide(ctx: {
    server: string;
    apiKey: string;
    code: string;
    accountId: string;
    network: string;
}, protocol: BlobProtocol, onProblem: ((message: string) => void) | undefined, file: {
    source: PlaintextSource;
    name: string;
    parentId: string | null;
    destination: string;
    streamPlaintextLen: number;
    sealedLen: number;
}): Promise<{
    ride: RecoveryRide;
    quiltLen: number | null;
}>;
