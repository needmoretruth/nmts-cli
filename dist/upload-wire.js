// The shapes the credit-paid upload speaks in — the storage-network protocol, the api calls, and
// what a failure is allowed to claim about money.
//
// ⛔ SEPARATE FROM THE MACHINE ON PURPOSE. `upload.ts` is a sequence of decisions about spending;
//    keeping the vocabulary here means a test can name every seam without importing that sequence,
//    and means the file that DOES spend stays short enough to read in one sitting.
import { HttpError, ServerError } from "./api.js";
import { NmtsError } from "./errors.js";
/**
 * A failure that names its phase — and, crucially, whether the account has already paid.
 *
 * ⛔ `paid` IS NOT COSMETIC. Before the reserve, a failure costs nothing and "try again" is honest
 *    advice. After it, the credits are gone and the storage exists; the honest advice is that the
 *    same command will FINISH it rather than buy it again, and that saying otherwise would send
 *    somebody to spend twice.
 *
 * ⛔ AND A REFUSAL KEEPS WHAT THE SERVER SAID ABOUT ITSELF. A program deciding whether to top up,
 *    wait or give up reads `code`, `status` and `retryAfter`; the sentence is for a person, and a
 *    program that matched on it would break the day it was reworded.
 */
export class UploadError extends NmtsError {
    phase;
    paid;
    /**
     * The server's own code when the server refused, exactly as `ServerError.code` carries it — or
     * `WALLET_SHORT` when the paying wallet was known to be short before anything was signed.
     * Absent for every other failure.
     */
    code;
    /** The HTTP status the server answered with. Absent when no answer came back. */
    status;
    /** Seconds to wait before asking again, from the server's `Retry-After`; null when it named none. */
    retryAfter;
    constructor(input) {
        super(input.message, { exitCode: input.exitCode ?? 1, nextStep: input.nextStep ?? null });
        this.name = "UploadError";
        this.phase = input.phase;
        this.paid = input.paid;
        const from = input.from;
        this.code = from instanceof ServerError ? from.code : input.code;
        this.status = from instanceof ServerError || from instanceof HttpError ? from.status : undefined;
        this.retryAfter = from instanceof ServerError ? from.retryAfter : undefined;
    }
}
