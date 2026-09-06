// ⛔ THE ONE FILE IN THIS TOOL THAT SIGNS. Everything it can do moves real assets and cannot be
//    reversed by anybody, including NMTS. It signs FIVE SHAPES and no others: extending a file's
//    storage (`signExtension`), sending SUI or WAL to an address (`signTransfer`), swapping one for
//    the other on a venue (`signSwap`), and the two halves of a wallet-paid upload — registering one
//    part's blob (`signBlobRegister`, which buys the storage or binds a held resource and pays the
//    relay's tip) and certifying it (`signBlobCertify`, gas only). A sixth shape is a decision made
//    here, in the open — the test pins the export list.
//
// ⛔ IT IS REACHED FROM `commands/extend.ts`, `commands/wallet-send.ts`, `commands/wallet-donate.ts`,
//    `commands/wallet-swap.ts` and `upload-wallet.ts` (the wallet rail `commands/put-wallet.ts`
//    drives), each after the price, the fee and the balances have been read and printed, and (a
//    gift excepted) after `requireWalletGrant(…)`. Nothing else imports it, and it is loaded lazily
//    so that a run which does not spend never even brings the code into memory.
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
import { transferTransaction } from "./wallet-send-chain.js";
import { storageOpTransaction } from "./storage-control-chain.js";
import { swapTransaction } from "./wallet-swap-chain.js";
import { isRecord } from "./guards.js";
import { certifyTransaction, createdBlob, payingClient, registerTransaction, } from "./upload-wallet-chain.js";
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
    // ⛔ SUCCESS IS ALREADY KNOWN — the effects above said so. This wait is for what happens NEXT:
    //    the server is told the digest, `nmts wallet` is run, the browser's activity list opens —
    //    and a full node that has not indexed the transaction yet answers those as if nothing
    //    happened. Waiting until it is readable is what the browser's signers do. A wait that times
    //    out changes nothing about what was signed, so it is not an error of this extension.
    await client.waitForTransaction({ digest: result.digest }).catch(() => undefined);
    return result.digest;
};
/**
 * Send SUI or WAL to one address, in ONE transaction, signed by the account's own wallet.
 *
 * ⛔ THE TRANSACTION IS BUILT BY `wallet-send-chain.ts`, the same builder the fee was measured
 *    with, so what is signed is what was priced. The destination is whatever the caller validated
 *    (`send-rules.ts`) — nothing here checks it again, and nothing can take it back.
 *
 * ⚠ A FAILURE HERE IS NOT PROOF THAT NOTHING HAPPENED — the same words as the extension above.
 */
export const signTransfer = async ({ network, code, shape }) => {
    const client = walrusClient(network);
    const keypair = await keypairFor(code);
    const tx = transferTransaction({ ...shape, sender: keypair.toSuiAddress() });
    const result = await client.signAndExecuteTransaction({
        transaction: tx,
        signer: keypair,
        options: { showEffects: true },
    });
    const effects = result.effects;
    const status = isRecord(effects) ? effects["status"] : undefined;
    const outcome = isRecord(status) ? status["status"] : undefined;
    if (outcome === "failure") {
        const why = isRecord(status) ? status["error"] : undefined;
        throw new NmtsError(`The chain refused the transfer: ${typeof why === "string" ? why : "no reason was given"}.`, {
            exitCode: 1,
            nextStep: `Nothing was sent. The transaction fee was spent. The usual cause is a balance that moved ` +
                `between reading it and signing — \`nmts wallet\` shows both balances now.`,
        });
    }
    await client.waitForTransaction({ digest: result.digest }).catch(() => undefined);
    return result.digest;
};
/**
 * Swap SUI for WAL or WAL for SUI on the named venue, in ONE transaction, signed by the account's
 * own wallet. Every output goes back to the signer — DeepBook's three coins are sent there by this
 * transaction, Bluefin's by its own entry function — so there is no destination to get wrong.
 *
 * ⛔ THE TRANSACTION IS BUILT BY `wallet-swap-chain.ts`, the same builder the fee was measured with,
 *    on the same Bluefin package the quote used. The minimum-out in the shape is what protects the
 *    person: the chain refuses a swap that would give less, and the fee for that refusal is spent.
 *
 * ⚠ A FAILURE HERE IS NOT PROOF THAT NOTHING HAPPENED — the same words as the extension above.
 */
export const signSwap = async ({ network, code, shape }) => {
    const client = walrusClient(network);
    const keypair = await keypairFor(code);
    const tx = swapTransaction({ ...shape, network, sender: keypair.toSuiAddress() });
    const result = await client.signAndExecuteTransaction({
        transaction: tx,
        signer: keypair,
        options: { showEffects: true },
    });
    const refused = refusedBecause(result);
    if (refused !== null) {
        throw new NmtsError(`The chain refused the swap: ${refused}.`, {
            exitCode: 1,
            nextStep: `Nothing was swapped. The transaction fee was spent. The usual causes are a price that moved ` +
                `past the minimum between the quote and the signature — quote again, or allow more slippage — ` +
                `or a balance that moved. \`nmts wallet\` shows both balances now.`,
        });
    }
    await client.waitForTransaction({ digest: result.digest }).catch(() => undefined);
    return result.digest;
};
/** What a refused execution said, or null when the effects say it went through. */
function refusedBecause(result) {
    const effects = isRecord(result) ? result["effects"] : undefined;
    const status = isRecord(effects) ? effects["status"] : undefined;
    if (!isRecord(status) || status["status"] !== "failure")
        return null;
    const why = status["error"];
    return typeof why === "string" ? why : "no reason was given";
}
/**
 * Register ONE part's blob, signed by the account's own wallet: the relay's tip, then the storage
 * — bought for `epochs`, or a resource the wallet already holds, cut to fit first if asked.
 *
 * ⛔ THE TRANSACTION IS BUILT BY `upload-wallet-chain.ts`, the same builder the fee was measured
 *    with, so what is signed is what was priced. What comes back is what the commit and the resume
 *    need: the digest the relay checks its tip in, the blob object, and the epoch the chain says
 *    the storage ends at.
 *
 * ⚠ A FAILURE HERE IS NOT PROOF THAT NOTHING HAPPENED — the same words as the extension above.
 *   The caller keeps its record and re-reads it rather than registering again.
 */
export const signBlobRegister = async ({ network, code, relayUrl, ...shape }) => {
    const client = payingClient(network, relayUrl);
    const keypair = await keypairFor(code);
    const tx = await registerTransaction(client, network, { ...shape, sender: keypair.toSuiAddress() });
    const result = await client.signAndExecuteTransaction({
        transaction: tx,
        signer: keypair,
        options: { showEffects: true, showObjectChanges: true },
    });
    const refused = refusedBecause(result);
    if (refused !== null) {
        throw new NmtsError(`The storage network refused the registration: ${refused}.`, {
            exitCode: 1,
            nextStep: `Nothing is stored and no storage was bought. The transaction fee was spent. The usual causes ` +
                `are too little WAL or SUI in this account's wallet — \`nmts wallet\` shows both — or a held ` +
                `resource too small for the part once encoded.`,
        });
    }
    await client.waitForTransaction({ digest: result.digest }).catch(() => undefined);
    const blob = await createdBlob(client, result.objectChanges);
    return { digest: result.digest, ...blob };
};
/** Certify ONE registered part from the relay's certificate. Gas only; nothing else leaves the wallet. */
export const signBlobCertify = async ({ network, code, relayUrl, ...shape }) => {
    const client = payingClient(network, relayUrl);
    const keypair = await keypairFor(code);
    const tx = certifyTransaction(client, shape);
    tx.setSender(keypair.toSuiAddress());
    const result = await client.signAndExecuteTransaction({
        transaction: tx,
        signer: keypair,
        options: { showEffects: true },
    });
    const refused = refusedBecause(result);
    if (refused !== null) {
        throw new NmtsError(`The storage network refused the certification: ${refused}.`, {
            exitCode: 1,
            nextStep: `The storage is bought and the bytes are on the network; only the certification failed, and ` +
                `its fee was spent. Running the same command again certifies again and buys nothing.`,
        });
    }
    await client.waitForTransaction({ digest: result.digest }).catch(() => undefined);
    return result.digest;
};
/**
 * Cut, join or hand over a storage resource, in ONE transaction, signed by the account's own wallet.
 *
 * ⛔ THE TRANSACTION IS BUILT BY `storage-control-chain.ts`, the same builder the dry run priced,
 *    so what is signed is what was reviewed. A failed execution still has a digest and still
 *    spent its gas, so the status is read and a failure is said as one.
 */
export const signStorageOp = async ({ network, code, shape, walrusPackageId }) => {
    const client = walrusClient(network);
    const keypair = await keypairFor(code);
    const tx = storageOpTransaction(shape, { walrusPackageId, sender: keypair.toSuiAddress() });
    const result = await client.signAndExecuteTransaction({ transaction: tx, signer: keypair, options: { showEffects: true } });
    const effects = result.effects;
    const status = isRecord(effects) ? effects["status"] : undefined;
    if (isRecord(status) && status["status"] === "failure") {
        const why = status["error"];
        throw new NmtsError(`The chain refused it: ${typeof why === "string" ? why : "no reason was given"}.`, {
            exitCode: 1,
            nextStep: "Nothing changed on the resource. The transaction fee was spent.",
        });
    }
    await client.waitForTransaction({ digest: result.digest }).catch(() => undefined);
    return result.digest;
};
