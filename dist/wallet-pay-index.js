// WHICH WALLET PAYS — the number this account keeps in its sealed file list, and the one flag that
// overrides it for a single run.
//
// ⛔ WHY IT IS NOT A CONSTANT ANY MORE (2026-09-16). One NMTS key derives a wallet at
//    every index (NCF-3 §1.3) and the account chooses which of them pays, so that a phone, a
//    laptop and this tool all spend from the same address. That choice lives where no server can
//    read it: inside the sealed list, beside the padding rule.
//
// ⛔ AND IT REFUSES RATHER THAN GUESSING. If the list cannot be read, this tool does not fall back
//    to the first wallet: that would sign with a wallet the person may not have funded, print a
//    review naming an address nobody chose, and — with `--yes` — spend from it. "I do not know
//    which wallet should pay" is an answer; wallet 0 is not.
//
// ⚠ THE NUMBER IS RESOLVED BEFORE ANYTHING IS PRICED. Every command that spends prints a review
//   with the paying address in it, so the address that is read, priced and shown has to be the
//   address that signs. Asking for the number at signing time would let those two differ.
import { NmtsError } from "./errors.js";
import { readFileList } from "./manifest.js";
import { BINARY_NAME } from "./product.js";
import { openSession } from "./session.js";
import { activeWalletOf, WALLET_INDEX_LIMIT } from "./shared/lib/drive/manifest-settings.js";
/**
 * A wallet number as a person typed it.
 *
 * ⛔ REFUSED, NEVER ROUNDED. `--wallet 1.5` and `--wallet -1` are command lines to correct; taking
 *    either of them to a neighbouring wallet would spend from an address nobody named.
 */
export function walletIndexOf(raw) {
    const text = raw.trim();
    const value = Number(text);
    if (!/^[0-9]+$/u.test(text) || !Number.isSafeInteger(value) || value >= WALLET_INDEX_LIMIT) {
        throw new NmtsError(`A wallet number is a whole number from 0 to ${WALLET_INDEX_LIMIT - 1}, not "${raw}".`, {
            exitCode: 2,
            nextStep: `\`${BINARY_NAME} wallet list\` shows this key's wallets and their numbers.`,
        });
    }
    return value;
}
/** Which wallet this run pays from: the flag if it was given, otherwise the account's own number. */
export async function payingWalletIndex(input) {
    const said = input.wallet;
    if (said !== undefined && said !== "")
        return walletIndexOf(said);
    const read = input.readActiveWallet ?? (() => fromSealedList(input));
    try {
        return await read();
    }
    catch (error) {
        // ⛔ A refusal this tool already worded (no API key, a locked code) is passed on as it stands —
        //    it names the thing to fix, and wrapping it would bury that under a second sentence.
        if (error instanceof NmtsError)
            throw error;
        throw new NmtsError(`Which wallet should pay is written in this account's file list, and it could not be read: ` +
            `${error instanceof Error ? error.message : String(error)}`, {
            exitCode: 1,
            nextStep: `Nothing was signed. Try again when the list can be read, or name the wallet for this ` +
                `one run with \`--wallet N\` — \`${BINARY_NAME} wallet list\` shows the numbers.`,
        });
    }
}
/** The account's own number, out of the sealed file list. One request, and no flag reaches it. */
async function fromSealedList(input) {
    const session = await openSession({ server: input.server, network: input.network });
    const list = await readFileList(session.server, session.apiKey, session.code, session.accountId);
    // An account that has never written a setting pays from the first wallet — that is a READ
    // answer, not a fallback: the list opened, and it said nothing about a wallet.
    return activeWalletOf(list.manifest?.settings);
}
