import { BodyRefusal, type Plan } from "./body-plan.ts";
import { type ChecksumAlgorithm } from "./checksum.ts";
/** The digests and checksums of the decoded bytes, computed as they pass. */
export declare class Measure {
    count: number;
    private readonly sha256;
    private readonly md5;
    private readonly checksums;
    constructor(plan: Plan);
    update(bytes: Buffer): void;
    /** The verdict on the whole body, in the order a client would want the first failure named. */
    judge(plan: Plan, trailerValues: ReadonlyMap<ChecksumAlgorithm, Buffer>): BodyRefusal | null;
}
