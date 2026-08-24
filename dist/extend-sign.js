// ⛔ THE ONE FILE IN THIS TOOL THAT SIGNS. Everything it can do moves real assets and cannot be
//    reversed by anybody, including NMTS.
//
// ⛔ IT IS REACHED FROM EXACTLY ONE PLACE: `commands/extend.ts`, after `requireConsent("wallet")`
//    and after the price has been read and printed. Nothing else imports it, and it is loaded
//    lazily so that a run which does not spend never even brings the code into memory.
//
// ⛔ NO KEY LEAVES THIS FILE. `wallet.ts` states the rule for the whole tool — no function returns
//    a seed, a private key or a keypair — and this file is the one exception to the reason for it
//    (something has to hold a key to sign) rather than to the rule itself: the keypair is built
//    inside a function, asked one question, and dropped. ⚠ `@mysten/sui` keeps the secret inside
//    its own object with no method that clears it, exactly as it does in the browser's worker; what
//    is controlled here is lifetime. The buffers this file makes — the derived material, the wallet
//    root, the seed — are wiped on every path out, failures included.
//
// ⛔ THE DERIVATION IS THE ENGINE'S, AT THE INDEX THE BROWSER USES. A second derivation written
//    here would be free to drift from the one `nmts wallet address` prints, and the way that
//    surfaces is a transaction signed by a wallet the person has never funded.
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { assertUsableCode } from "./account.js";
import { DERIVED, loadCrypto } from "./crypto.js";
import { NmtsError } from "./errors.js";
import { walrusClient } from "./extend-chain.js";
import { isRecord } from "./guards.js";
import { BUILT_IN_WALLET_INDEX } from "./wallet.js";
/**
 * The keypair the account code derives.
 *
 * ⛔ NOT EXPORTED. A caller that could hold this could sign anything, and the whole of this tool's
 *    story about the wallet is that one command signs one shape of transaction.
 */
async function keypairFor(code) {
    // The one refusal text for a malformed code lives in `account.ts`, so a typo fails here the same
    // way it fails everywhere else in this tool rather than as an engine error.
    await assertUsableCode(code);
    const glue = await loadCrypto();
    let bytes = null;
    let derived = null;
    let root = null;
    let seed = null;
    try {
        bytes = glue.account_code_parse(code);
        // ⛔ THIS BUFFER IS EVERY KEY IN THE ACCOUNT, not just the wallet root: the sign-in secret, the
        //    key that opens the files, the key that opens the file list.
        derived = glue.kdf_derive(bytes);
        const [from, to] = DERIVED.walletRoot;
        root = derived.slice(from, to);
        seed = glue.wallet_seed_for(root, BUILT_IN_WALLET_INDEX);
        return Ed25519Keypair.fromSecretKey(seed);
    }
    catch (error) {
        if (error instanceof NmtsError)
            throw error;
        // ⛔ An engine message about a code can carry the code (`errors.ts`), so it is never passed on.
        throw new NmtsError("The account code could not be read on this machine.", { exitCode: 1 });
    }
    finally {
        seed?.fill(0);
        root?.fill(0);
        derived?.fill(0);
        bytes?.fill(0);
    }
}
/**
 * The address this tool would sign as.
 *
 * ⛔ IT EXISTS TO BE HELD AGAINST `walletAddress`. That function is what `nmts wallet address`
 *    prints and what somebody funds; this one is what a transaction would actually be signed by.
 *    Nothing else in this package proves the two are the same wallet, and the failure if they ever
 *    part is silent — a signature from an address with nothing in it, or worse, money sent to an
 *    address that signs nothing. A test compares them, offline, for free.
 */
export async function signerAddress(code) {
    return (await keypairFor(code)).toSuiAddress();
}
/**
 * Extend every listed blob by `epochs`, in ONE transaction, signed by the account's own wallet.
 *
 * ONE SIGNATURE FOR ALL OF IT: `extendBlob` returns a transaction fragment, so every blob a file
 * sits on goes into the same transaction. A multi-part file is one payment and one gas fee, not
 * five — and a partial extension would buy nothing, because one expired blob is enough to make the
 * file unreadable.
 *
 * ⛔ THE IDS ARE DE-DUPLICATED. Naming the same blob twice pays for the same epochs twice.
 *
 * ⚠ A FAILURE HERE IS NOT PROOF THAT NOTHING HAPPENED. A refusal from the node, a timeout, a
 *   connection that dropped after the bytes went out — none of them say whether the transaction
 *   was executed. The caller re-reads the chain rather than offering a second attempt against
 *   numbers it read before.
 */
export const signExtension = async ({ network, code, objectIds, epochs }) => {
    const unique = [...new Set(objectIds)];
    if (unique.length === 0) {
        throw new NmtsError("There is nothing on this file that can be extended.", { exitCode: 4 });
    }
    if (!Number.isSafeInteger(epochs) || epochs <= 0) {
        throw new NmtsError("An extension must be a positive whole number of epochs.", { exitCode: 2 });
    }
    const client = walrusClient(network);
    const keypair = await keypairFor(code);
    const tx = new Transaction();
    // The sender must be set before the fragments resolve: paying with the SDK's default coin
    // selection picks the WAL coins from the sender's own address.
    tx.setSender(keypair.toSuiAddress());
    for (const blobObjectId of unique) {
        tx.add(client.walrus.extendBlob({ blobObjectId, epochs }));
    }
    const result = await client.signAndExecuteTransaction({
        transaction: tx,
        signer: keypair,
        options: { showEffects: true },
    });
    // ⛔ A DIGEST IS NOT A SUCCESS. A transaction that was executed and FAILED still has one, and the
    //    gas for it is still gone; recording it as an extension would move the drive's expiry date
    //    over storage nobody bought. The status is asked for above and read here.
    const effects = result.effects;
    const status = isRecord(effects) ? effects["status"] : undefined;
    const outcome = isRecord(status) ? status["status"] : undefined;
    if (outcome === "failure") {
        const why = isRecord(status) ? status["error"] : undefined;
        throw new NmtsError(`The storage network refused the extension: ${typeof why === "string" ? why : "no reason was given"}.`, {
            exitCode: 1,
            nextStep: `The storage was NOT extended and the file still ends when it did. The transaction fee ` +
                `was spent. The usual causes are too little WAL or SUI in this account's wallet — ` +
                `\`nmts wallet\` shows both — or a length the network will no longer sell.`,
        });
    }
    return result.digest;
};
