import { type ChecksumAlgorithm } from "./checksum.ts";
/** What a finish says the whole object comes to. */
export interface ObjectChecksum {
    readonly algorithm: ChecksumAlgorithm;
    readonly value: Buffer;
    readonly type: "FULL_OBJECT" | "COMPOSITE";
}
/**
 * Check a composite checksum against the pieces' own, before anything is joined. Returns without
 * checking when a piece has no checksum of that kind (see the top of this file).
 */
export declare function checkComposite(checksum: ObjectChecksum | null | undefined, pieces: ReadonlyArray<ReadonlyMap<ChecksumAlgorithm, Buffer>>): void;
/**
 * Write these files one after another into a new file, 0600, computing a `FULL_OBJECT` checksum
 * as they pass, and refuse the result when it does not match.
 */
export declare function joinPieces(whole: string, paths: readonly string[], checksum?: ObjectChecksum | null): Promise<void>;
