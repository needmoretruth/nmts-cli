// The real Walrus protocol client — the ONE file in this tool that loads the storage network's SDK.
//
// ⛔ SPLIT OUT FROM `upload.ts` ON PURPOSE. That file decides what gets bought and when; this one
//    only knows how to talk to the network. Keeping the SDK out of it is what lets `node --test`
//    drive every spending decision, including all of its failure branches, against fakes.
//
// ⛔ THERE IS NO SIGNER HERE AND NOTHING IS BUILT AS A TRANSACTION. On the credit rail the server
//    registers the blob and pays the relay's tip out of the treasury; this tool computes the id
//    locally and hands over the bytes. The one thing it must get right is telling the relay WHICH
//    transaction paid — see the note on `sendTip` below, which is not what its name suggests.
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { walrus } from "@mysten/walrus";
import { epochClock } from "./expiry.js";
import { NmtsError } from "./errors.js";
import { countingFetch } from "./progress.js";
import { relayHost, suiRpcHost } from "./walrus.js";
/**
 * How long the relay gets for one blob PUT, sized to the body.
 *
 * The SDK's own default is 30 seconds, which a multi-megabyte body cannot finish on an ordinary
 * connection — and a timeout here happens AFTER the storage is paid for.
 */
export function relayTimeoutMs(bodyBytes) {
    const perMiB = 20_000;
    const floor = 60_000;
    return Math.max(floor, Math.ceil((bodyBytes / 2 ** 20) * perMiB));
}
/**
 * ⛔ `sendTip` IS A FLAG HERE, NOT A BUDGET. The SDK decides whether to tell the relay which
 *    transaction paid its tip by asking `!!config.uploadRelay.sendTip` — with the field absent it
 *    sends the bytes WITHOUT the nonce and the transaction id, and the relay refuses them because
 *    as far as it can tell nobody paid. On this rail the treasury already paid, inside the
 *    register transaction; this tool holds no wallet and cannot pay anything whatever this number
 *    says. It is a ceiling on a payment that has no way of happening.
 *
 * ⚠ Which also means it does NOT have to agree with the browser's ceiling, and no gate holds the
 *   two level: the browser's number bounds a real payment made by a real wallet.
 */
const TIP_CEILING_UNUSED_MIST = 1;
function extend(network, relayUrl, bodyBytes, onSent) {
    const base = new SuiJsonRpcClient({
        // ⛔ The network name reaches the SDK as well as the URL. A mirror pointed at the wrong chain
        //    would otherwise be discovered as a blob the storage nodes refuse, after the money moved.
        network: network === "mainnet" ? "mainnet" : "testnet",
        url: suiRpcHost(network),
    });
    return base.$extend(walrus({
        uploadRelay: {
            host: relayUrl,
            sendTip: { max: TIP_CEILING_UNUSED_MIST },
            timeout: relayTimeoutMs(bodyBytes),
            // ⛔ THE ONLY WAY TO SEE AN UPLOAD MOVE. The SDK does not report progress, and the relay
            //    PUT is the one step of an upload that takes real time — a person watching a large
            //    file with no feedback cannot tell a slow upload from a hung one, and neither can an
            //    agent deciding whether to give up.
            ...(onSent ? { fetch: countingFetch(onSent) } : {}),
        },
    }));
}
function fail(what, error) {
    throw new NmtsError(`${what}: ${error instanceof Error ? error.message : String(error)}`);
}
/**
 * Build a protocol client bound to ONE relay, for ONE upload of a known size.
 *
 * `onSent` is called as the request body leaves — that is the honest measure of an upload, and it
 * is the only phase of one that anything can report on.
 */
export function createBlobProtocol(network, bodyBytes, onSent) {
    const relayUrl = relayHost(network);
    const client = extend(network, relayUrl, bodyBytes, onSent);
    return {
        relayUrl,
        async computeMetadata({ bytes, nonce }) {
            // ⛔ The shard count is NOT supplied. It is a property of the live storage network, the
            //    erasure coding depends on it, and a number written down here would be right until the
            //    day it was not — at which point every id this tool computed would be refused after the
            //    credits had moved. The SDK reads it from the chain.
            const meta = await client.walrus
                .computeBlobMetadata({
                bytes,
                // Omitted rather than passed as undefined so the SDK's own "make a random one" path runs
                // on a first encode; supplied on a retry so the digest reproduces bit for bit.
                ...(nonce ? { nonce } : {}),
            })
                .catch((error) => fail("The storage network's encoder could not prepare this file", error));
            return {
                blobId: meta.blobId,
                rootHash: meta.rootHash,
                nonce: meta.nonce,
                // The SDK hands this back as a thunk, because computing it costs a hash of the encoded
                // blob. Awaited once here so nothing downstream has to know it was ever lazy.
                blobDigest: await meta.blobDigest(),
            };
        },
        async uploadToRelay({ blobId, bytes, nonce, registerTxDigest, blobObjectId }) {
            const { certificate } = await client.walrus
                .writeBlobToUploadRelay({
                blobId,
                blob: bytes,
                nonce,
                txDigest: registerTxDigest,
                blobObjectId,
                // Not a choice made here: the chain service hard-codes it and refuses a registration
                // that says otherwise, so a different value would make the relay reject these bytes.
                deletable: true,
            })
                .catch((error) => fail("The upload relay refused the bytes", error));
            return {
                signers: certificate.signers,
                serialized_message_b64: Buffer.from(certificate.serializedMessage).toString("base64url"),
                signature_b64: Buffer.from(certificate.signature).toString("base64url"),
            };
        },
    };
}
/**
 * The storage network's current epoch, or `null` when it could not be read.
 *
 * ⚠ ADVISORY ONLY. It becomes the `expiry_epoch` the server records beside the file, which the
 *   chain — not this number — is the authority on. `null` is written as 0, meaning "not recorded",
 *   which is honest; inventing a number would put a date in the drive that nothing stands behind.
 */
export async function readCurrentEpoch(network) {
    try {
        const base = new SuiJsonRpcClient({
            network: network === "mainnet" ? "mainnet" : "testnet",
            url: suiRpcHost(network),
        }).$extend(walrus({}));
        // The epoch lives on the COMMITTEE, not beside it: the system state describes capacity and
        // the deny lists as well, and only the committee is stamped with which epoch it serves.
        const state = await base.walrus.systemState();
        const epoch = state.committee.epoch;
        return typeof epoch === "number" ? epoch : null;
    }
    catch {
        return null;
    }
}
/**
 * The storage network's epoch clock: which epoch, how long one lasts, and when this one began.
 *
 * ⛔ THE EPOCH LENGTH IS READ, NEVER ASSUMED. It is one day on one network and fourteen on the
 *    other, so a constant borrowed from either would turn "fourteen days left" into "196 days
 *    left" on the wrong one — beside a sentence about a file being deleted.
 *
 * ⚠ `startedMs` is usually ABSENT and that is normal, not a failure: the network only carries the
 *   moment an epoch settled while it is not changing epochs. Everything downstream treats its
 *   absence as "the day count is a lower bound", which is the safe direction.
 *
 * `null` means the clock could not be read at all. ⛔ The caller must say so rather than draw a
 * drive with nothing expiring — an unread clock and an account in no danger look identical from
 * the outside and are the opposite of each other.
 */
export async function readEpochWindow(network) {
    try {
        const base = new SuiJsonRpcClient({
            network: network === "mainnet" ? "mainnet" : "testnet",
            url: suiRpcHost(network),
        }).$extend(walrus({}));
        const [system, staking] = await Promise.all([base.walrus.systemState(), base.walrus.stakingState()]);
        // Both numbers can arrive as strings — Sui reports 64-bit values that way — so they are
        // converted here and the constructor below refuses whatever did not survive it.
        const epoch = system.committee.epoch;
        const duration = staking.epoch_duration;
        return epochClock(Number(epoch), Number(duration), epochStartedMs(staking.epoch_state));
    }
    catch {
        return null;
    }
}
/**
 * When the current epoch began, or null.
 *
 * `epoch_state` is a tagged union and only its settled variant carries the moment. Read by name
 * rather than cast: a shape change in the protocol has to surface as "no anchor", which costs the
 * caller precision, instead of as a NaN that becomes a date.
 *
 * ⛔ EXPORTED SO THERE IS ONE OF IT. `extend-chain.ts` reads the same two states for a different
 *    reason and needs the same anchor; a second copy of this narrowing would be a second answer to
 *    "has this epoch settled", and the two would drift the day the protocol renames the variant.
 */
export function epochStartedMs(epochState) {
    if (typeof epochState !== "object" || epochState === null)
        return null;
    if (Reflect.get(epochState, "$kind") !== "EpochChangeDone")
        return null;
    const at = Number(Reflect.get(epochState, "EpochChangeDone"));
    return Number.isFinite(at) ? at : null;
}
