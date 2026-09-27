// The digests and checksums of an upload's decoded bytes, and the verdict on them once the last
// byte is in. One of the parts of `body.ts`; only it imports this.
import { createHash } from "node:crypto";
import { BodyRefusal, incomplete, invalid } from "./body-plan.js";
import { checksumHeaderName, runningChecksum } from "./checksum.js";
/** The digests and checksums of the decoded bytes, computed as they pass. */
export class Measure {
    count = 0;
    sha256;
    md5;
    checksums = new Map();
    constructor(plan) {
        this.sha256 = plan.payloadDigest === null ? null : createHash("sha256");
        this.md5 = plan.contentMd5 === null ? null : createHash("md5");
        for (const algorithm of plan.headerChecksums.keys())
            this.checksums.set(algorithm, runningChecksum(algorithm));
        for (const algorithm of plan.trailers)
            this.checksums.set(algorithm, runningChecksum(algorithm));
    }
    update(bytes) {
        this.count += bytes.length;
        this.sha256?.update(bytes);
        this.md5?.update(bytes);
        for (const running of this.checksums.values())
            running.update(bytes);
    }
    /** The verdict on the whole body, in the order a client would want the first failure named. */
    judge(plan, trailerValues) {
        if (this.count !== plan.size) {
            return incomplete(`the body has ${this.count} bytes and the request declared ${plan.size}`);
        }
        if (this.sha256 !== null && this.sha256.digest("hex") !== plan.payloadDigest) {
            return new BodyRefusal(400, "XAmzContentSHA256Mismatch", "The provided 'x-amz-content-sha256' header does not match what was computed.");
        }
        if (this.md5 !== null && plan.contentMd5 !== null && !this.md5.digest().equals(plan.contentMd5)) {
            return new BodyRefusal(400, "BadDigest", "The Content-MD5 you specified did not match what we received.");
        }
        for (const [algorithm, running] of this.checksums) {
            const expected = plan.headerChecksums.get(algorithm) ?? trailerValues.get(algorithm);
            if (expected === undefined)
                return invalid(`${checksumHeaderName(algorithm)} never arrived`);
            if (!running.digest().equals(expected)) {
                return new BodyRefusal(400, "BadDigest", `The ${algorithm.toUpperCase()} you specified did not match the calculated checksum.`);
            }
        }
        return null;
    }
}
