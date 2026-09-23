// WHO PAYS FOR AN UPLOAD, and which options mean anything once that is answered.
//
// ⛔ THE OPTIONS ARE REFUSED, NOT IGNORED. `--epochs 12 --pay credits` is somebody asking for a
//    term credits do not sell; accepting it silently would upload for a different length than the
//    person typed and charge them for it. Every refusal here happens before a file is measured.
//
// ⚠ They moved out of `put.ts` on 2026-09-16 (`--wallet` joined them and that file has a ceiling).
//   `put.ts` re-exports them, so `push.ts` and the tests spell the same path they always did.
import { NmtsError } from "../errors.js";
/** Who pays, or a refusal for a payer this tool does not know. */
export function payerOf(pay) {
    if (pay === undefined || pay === "credits")
        return "credits";
    if (pay === "wallet")
        return "wallet";
    throw new NmtsError(`--pay takes credits or wallet, not "${pay}".`, {
        exitCode: 2,
        nextStep: `Nothing was sent. --pay wallet buys the storage from the wallet this NMTS key derives; without it credits pay.`,
    });
}
/** The options that only mean something when the wallet pays, refused when it does not. */
export function refuseWalletOnlyOptions(options) {
    if (options.wallet !== undefined) {
        throw new NmtsError("--wallet only applies with --pay wallet: credits are not held in a wallet.", {
            exitCode: 2,
            nextStep: `Nothing was sent. Add --pay wallet to pay from one of this key's wallets.`,
        });
    }
    if (options.epochs !== undefined) {
        throw new NmtsError("--epochs only applies with --pay wallet: one credit buys a fixed term.", {
            exitCode: 2,
            nextStep: `Nothing was sent. Add --pay wallet to choose the term, or leave --epochs off to pay with credits.`,
        });
    }
    if (options.storage !== undefined) {
        throw new NmtsError("--storage only applies with --pay wallet: credits buy storage from the treasury.", {
            exitCode: 2,
            nextStep: `Nothing was sent. Add --pay wallet to use a storage resource this wallet holds.`,
        });
    }
    if (options.from !== undefined) {
        throw new NmtsError("--from only applies with --pay wallet: it is how a credit-paid file moves onto the wallet.", {
            exitCode: 2,
            nextStep: `Nothing was sent. Add --pay wallet, which is what the re-upload is for.`,
        });
    }
    if (options.trustServerTipAddress === true) {
        throw new NmtsError("--trust-server-tip-address only applies with --pay wallet: a standing gift follows a wallet payment.", {
            exitCode: 2,
            nextStep: `Nothing was sent. A credit-paid upload sends no gift, so there is no address to trust.`,
        });
    }
}
