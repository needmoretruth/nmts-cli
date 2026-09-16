// `nmts wallet use <number>` — which of this key's wallets pays for storage from now on.
//
// ⛔ IT WRITES THE ACCOUNT'S CHOICE, NOT THIS MACHINE'S. The number lives inside the sealed file
//    list (`activeWallet`), where the server cannot read it and where a phone, a laptop and this
//    tool all find the same answer. That is the whole point: money leaving from one address on one
//    device and another address on another is how a balance goes missing without anything failing.
//
// ⛔ THE LIST IS WHERE THE SETTING LIVES, so an account with no list has nowhere to put it — the
//    same refusal `nmts padding` gives, for the same reason, and the same way out: upload once.
//
// ⛔ NOTHING IS DELETED AND NOTHING IS CREATED. Every number a key can derive already exists
//    (NCF-3 §1.3); this says which of them the next payment comes out of, and takes the count up
//    with it so every screen lists the wallet it just named.
import { NmtsError } from "../errors.js";
import { readFileList } from "../manifest.js";
import { applyManyToList } from "../manifest-write.js";
import { BINARY_NAME } from "../product.js";
import { openSession } from "../session.js";
import { walletIndexOf } from "../wallet-pay-index.js";
import { walletAddress } from "../wallet.js";
export async function walletUse(said, options = {}) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    if (said === undefined || said === "") {
        throw new NmtsError(`Say which wallet: \`${BINARY_NAME} wallet use <number>\`.`, {
            exitCode: 2,
            nextStep: `\`${BINARY_NAME} wallet list\` shows this key's wallets and which one pays now.`,
        });
    }
    // ⛔ BEFORE THE NETWORK. A misspelled number is a command line to fix, not a question to ask the
    //    server, and a run that opened a session first would refuse for the wrong reason.
    const index = walletIndexOf(said);
    const session = await openSession({ server: options.server, network: options.network });
    const before = await readFileList(session.server, session.apiKey, session.code, session.accountId);
    if (before.manifest === null) {
        throw new NmtsError(`This account has no file list yet; which wallet pays lives in the list, and there is nothing to write it into.`, { exitCode: 4, nextStep: `Upload once (\`${BINARY_NAME} put\`) and set it after.` });
    }
    const result = await applyManyToList(session, () => [], { activeWallet: index });
    const address = await walletAddress(session.code, index);
    if (options.json === true) {
        say(JSON.stringify({ wallet: index, address, changed: result.changed }));
        return 0;
    }
    if (!result.changed) {
        say(`Wallet ${index} was already the one that pays. Nothing changed.`);
        say(`Address  ${address}`);
        return 0;
    }
    say(`Wallet ${index} pays from now on.`);
    say(`Address  ${address}`);
    say(``);
    say(`  Storage paid from this account's wallet now leaves this address, on every device — the`);
    say(`  number rides in the sealed file list, not on this machine. What is already stored is`);
    say(`  unaffected, and the wallets you were using keep whatever is in them.`);
    return 0;
}
