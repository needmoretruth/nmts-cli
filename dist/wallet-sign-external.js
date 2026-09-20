// Paying with a wallet this tool holds no key to: the caller signs, this file submits and judges.
//
// ⛔ WHY IT IS NOT IN `wallet-sign.ts`. That file is the one place a key is derived from the NMTS
//    key, and every signature in it is made by a keypair it builds itself. Here the key is somebody
//    else's — a browser extension, a hardware wallet, a remote signer — and nothing below ever
//    holds one. The TRANSACTIONS ARE THE SAME BUILDERS those signers use, so a wallet-paid upload
//    buys exactly the same thing whoever signs it; what differs is who is asked.
//
// ⛔ THE NMTS KEY ARRIVES HERE AND IS NOT READ. The seams carry `code` and `wallet` because the
//    keypair signers need them; every function below names only the fields it uses, so a reader can
//    see that the account's key plays no part in a transaction somebody else's wallet signs.
//
// ⛔ THE SENDER IS THE PAYER'S ADDRESS, AND IT IS THE ADDRESS THE PRICE WAS MEASURED AGAINST. An
//    upload and an extension take `payer` before they read a balance (`upload-wallet-put.ts`,
//    `storage-control/extend.ts`), so the quote, both balances, the measured fee and the sentence
//    that says where to send coins all name this wallet. A signer used without that payer would
//    price one wallet and sign with another — which is why neither is reachable without the other.
//
// ⛔ ONE SIGNATURE IS SUBMITTED ONCE, HOWEVER OFTEN THE LINE DROPS. A transaction's digest is a hash
//    of its bytes, so the same bytes are the same transaction: a submission whose reply was lost is
//    looked up by that digest before anything is sent again. Re-signing instead would pay twice for
//    a registration and be refused as "already certified" for a certification.
//
// ⛔ A DIGEST IS NOT A SUCCESS. A transaction that executed and FAILED has one, and its fee is
//    spent; the effects are read and a failure is said as one, exactly as the keypair signers do.
//
// ⛔ EVERY TRANSACTION IS ONE CALL TO THE CALLER'S FUNCTION. Nothing here batches signatures,
//    approves one silently or keeps a record of what was spent: a wallet outside this process
//    decides each time, and a part of a file is a signature of its own.
//
// ⚠ WHAT IS SUBMITTED IS WHAT THE WALLET ANSWERED WITH. The wallet standard has a wallet hand back
//   the bytes it signed, and some wallets adjust a transaction before signing one (a sponsor, a gas
//   station); the signature is over those bytes, so those are the bytes that go to the chain. The
//   effects read afterwards are what judge the result.
import { Transaction, TransactionDataBuilder } from "@mysten/sui/transactions";
import { fromBase64 } from "@mysten/sui/utils";
import { NmtsError } from "./errors.js";
import { walrusClient } from "./extend-chain.js";
import { isRecord } from "./guards.js";
import { isTransient, keepTrying } from "./net-retry.js";
import { storageOpTransaction } from "./storage-control-chain.js";
import { certifyTransaction, createdBlob, payingClient, registerTransaction } from "./upload-wallet-chain.js";
function why(error) {
    return error instanceof Error ? error.message : String(error);
}
/** What a refused execution said, or null when the effects say it went through. */
function refusedBecause(result) {
    const status = isRecord(result.effects) ? result.effects["status"] : undefined;
    if (!isRecord(status) || status["status"] !== "failure")
        return null;
    const reason = status["error"];
    return typeof reason === "string" ? reason : "no reason was given";
}
/** `sui:mainnet` or `sui:testnet` — what a wallet is told the transaction is for. */
function chainOf(network) {
    return `sui:${network === "mainnet" ? "mainnet" : "testnet"}`;
}
/**
 * One transaction, from bytes to a judged result: ask the wallet, submit it once, read the effects.
 *
 * ⛔ THE ONLY THING THAT CAN THROW BEFORE A SIGNATURE EXISTS IS THE WALLET SAYING NO, and it is
 *    named `WALLET_REFUSED` rather than passed on as whatever the wallet threw: a person who
 *    declined is not a broken wallet, and a caller that cannot tell them apart shows the wrong
 *    sentence to somebody who did exactly what they meant to.
 */
export async function signAndSubmit(client, payer, input) {
    let answered;
    try {
        answered = await payer.signTransaction({ bytes: input.bytes, chain: chainOf(input.network) });
    }
    catch (error) {
        throw new NmtsError(`WALLET_REFUSED: the wallet did not sign — ${why(error)}`, {
            exitCode: 4,
            nextStep: `${input.refusals.unsigned} A wallet refuses when somebody declines it, when it is on another network, or when it cannot sign this shape at all.`,
        });
    }
    const signed = typeof answered.bytes === "string" ? fromBase64(answered.bytes) : answered.bytes;
    const digest = TransactionDataBuilder.getDigestFromBytes(signed);
    const options = { showEffects: true, showObjectChanges: true };
    let sent = false;
    const result = await keepTrying(async () => {
        if (sent) {
            // The attempt before this one may have reached the chain and lost only its reply. An
            // unknown digest and a node that did not answer look the same here, and both mean "send
            // the same bytes again" — which is safe precisely because they are the same bytes.
            const seen = await client.getTransactionBlock({ digest, options }).catch(() => null);
            if (seen !== null)
                return seen;
        }
        sent = true;
        return client.executeTransactionBlock({ transactionBlock: signed, signature: answered.signature, options });
    }, { ...input.retry, retryable: isTransient });
    // ⛔ SUCCESS IS ALREADY DECIDED BY THE EFFECTS BELOW. This wait is for what happens NEXT — the
    //    relay being told the digest, the blob object being read back — because a node that has not
    //    indexed the transaction yet answers those as if nothing had happened. A wait that times out
    //    changes nothing about what was signed, so it is not a failure of this transaction.
    await client.waitForTransaction({ digest: result.digest }).catch(() => undefined);
    const refused = refusedBecause(result);
    if (refused !== null) {
        throw new NmtsError(`${input.refusals.refused.what}: ${refused}.`, {
            exitCode: 1,
            nextStep: input.refusals.refused.nextStep,
        });
    }
    return result;
}
/**
 * The two halves of a wallet-paid upload, signed by a wallet outside this tool: registering one
 * part's blob (which buys the storage or binds a held resource, and pays the relay's tip) and
 * certifying it (gas only).
 *
 * ⛔ THE BUILDERS ARE `upload-wallet-chain.ts`'s OWN — the same ones the measured fee came from and
 *    the same ones the keypair signers use. What is registered, bought and tipped is therefore the
 *    same transaction whichever wallet signs it.
 */
export function externalBlobSigners(payer) {
    return {
        register: async ({ network, relayUrl, epochs, storage, part }) => {
            const client = payingClient(network, relayUrl);
            const tx = await registerTransaction(client, network, { epochs, storage, part, sender: payer.address });
            const result = await signAndSubmit(client, payer, {
                network,
                bytes: await tx.build({ client }),
                refusals: {
                    unsigned: "No storage was bought, nothing was sent, and the tip was not paid.",
                    refused: {
                        what: "The storage network refused the registration",
                        nextStep: `Nothing is stored and no storage was bought. The transaction fee was spent. The usual ` +
                            `causes are too little WAL or SUI in the paying wallet — ${payer.address} — or a held ` +
                            `storage resource too small for this part once encoded.`,
                    },
                },
            });
            // The blob object is found by its type in what the transaction created, not by position.
            return { digest: result.digest, ...(await createdBlob(client, result.objectChanges)) };
        },
        certify: async ({ network, relayUrl, blobId, blobObjectId, certificate }) => {
            const client = payingClient(network, relayUrl);
            const tx = certifyTransaction(client, { blobId, blobObjectId, certificate });
            tx.setSender(payer.address);
            const result = await signAndSubmit(client, payer, {
                network,
                bytes: await tx.build({ client }),
                refusals: {
                    unsigned: "The storage is bought and the bytes are on the network; only the certification is unsigned. " +
                        "Running the same upload again asks for that one signature and buys nothing.",
                    refused: {
                        what: "The storage network refused the certification",
                        nextStep: `The storage is bought and the bytes are on the network; only the certification failed, ` +
                            `and its fee was spent. Running the same upload again certifies again, which costs gas ` +
                            `and nothing else.`,
                    },
                },
            });
            return result.digest;
        },
    };
}
/**
 * Extending every blob under one file by `epochs`, in ONE transaction signed by a wallet outside
 * this tool. The ids are de-duplicated: naming a blob twice pays for the same epochs twice.
 *
 * ⚠ The transaction is the shape `extend-chain.ts` measured the fee of — sender, de-duplicated ids,
 *   one fragment per blob — so what is approved is what was priced.
 */
export function externalExtendSigner(payer) {
    return async ({ network, objectIds, epochs }) => {
        const unique = [...new Set(objectIds)];
        if (unique.length === 0) {
            throw new NmtsError("There is nothing on this file that can be extended.", { exitCode: 4 });
        }
        if (!Number.isSafeInteger(epochs) || epochs <= 0) {
            throw new NmtsError("An extension must be a positive whole number of epochs.", { exitCode: 2 });
        }
        const client = walrusClient(network);
        const tx = new Transaction();
        // The sender goes first: the fragments below pick this address's WAL when they resolve.
        tx.setSender(payer.address);
        for (const blobObjectId of unique)
            tx.add(client.walrus.extendBlob({ blobObjectId, epochs }));
        const result = await signAndSubmit(client, payer, {
            network,
            bytes: await tx.build({ client }),
            refusals: {
                unsigned: "The storage was NOT extended and the file still ends when it did. Nothing was spent.",
                refused: {
                    what: "The storage network refused the extension",
                    nextStep: `The storage was NOT extended and the file still ends when it did. The transaction fee was ` +
                        `spent. The usual causes are too little WAL or SUI in the paying wallet — ${payer.address} — ` +
                        `or a length the network will no longer sell.`,
                },
            },
        });
        return result.digest;
    };
}
/**
 * Cutting, joining or handing over a storage resource, signed by a wallet outside this tool.
 *
 * ⛔ THE RESOURCE MUST BE THAT WALLET'S. The review reads the resources at the address it was given
 *    and this signs as the same address, so a resource held somewhere else is refused by the chain
 *    rather than half-done here.
 */
export function externalStorageOpSigner(payer) {
    return async ({ network, shape, walrusPackageId }) => {
        const client = walrusClient(network);
        const tx = storageOpTransaction(shape, { walrusPackageId, sender: payer.address });
        const result = await signAndSubmit(client, payer, {
            network,
            bytes: await tx.build({ client }),
            refusals: {
                unsigned: "Nothing changed on the resource and nothing was spent.",
                refused: {
                    what: "The chain refused it",
                    nextStep: "Nothing changed on the resource. The transaction fee was spent.",
                },
            },
        });
        return result.digest;
    };
}
