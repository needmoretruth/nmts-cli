// The shapes the credit-paid upload speaks in — the storage-network protocol, the api calls, and
// what a failure is allowed to claim about money.
//
// ⛔ SEPARATE FROM THE MACHINE ON PURPOSE. `upload.ts` is a sequence of decisions about spending;
//    keeping the vocabulary here means a test can name every seam without importing that sequence,
//    and means the file that DOES spend stays short enough to read in one sitting.
import { NmtsError } from "./errors.js";
/**
 * A failure that names its phase — and, crucially, whether the account has already paid.
 *
 * ⛔ `paid` IS NOT COSMETIC. Before the reserve, a failure costs nothing and "try again" is honest
 *    advice. After it, the credits are gone and the storage exists; the honest advice is that the
 *    same command will FINISH it rather than buy it again, and that saying otherwise would send
 *    somebody to spend twice.
 */
export class UploadError extends NmtsError {
    phase;
    paid;
    constructor(input) {
        super(input.message, { exitCode: 1, nextStep: input.nextStep ?? null });
        this.name = "UploadError";
        this.phase = input.phase;
        this.paid = input.paid;
    }
}
