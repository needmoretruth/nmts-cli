// The steps both recovery artefacts share: prove the code, read the account, seal the list.
//
// ⛔ ONE PLACE, BECAUSE THE TWO COMMANDS MUST NOT DISAGREE. `recovery-list` writes the sealed list
//    as a file of its own; `kit` writes the same document inside the one file that also carries the
//    account code. If those were assembled twice, one of them would eventually be built from a
//    check the other had dropped — and the difference would only show up in a recovery.
//
// ⛔ THE CAPTURE TIME IS STAMPED BEFORE ANYTHING IS READ. The server keeps it to decide which files
//    count as "not in your list yet". Stamped after the walk, it would leave a hole exactly the
//    width of the walk: a file created while the pages were being read would be in neither the
//    list nor the count. It is also clamped server-side, so claiming the future buys nothing.
//
// ⛔ THE DATA KEY IS DERIVED HERE AND WIPED HERE. It opens every file in the account; the
//    derivation output it is cut from holds the wallet root and the sign-in secret as well, so it
//    is zeroed on every path out, including the failing one.
import { accountProofFor } from "./account-proof.js";
import { request, ServerError } from "./api.js";
import { DERIVED, loadCrypto } from "./crypto.js";
import { NmtsError } from "./errors.js";
import { readFileList } from "./manifest.js";
import { BINARY_NAME } from "./product.js";
import { artifactAbout } from "./artifact-about.js";
import { buildRecoveryList } from "./recovery-build.js";
import { buildRecoveryMapFile } from "./recovery-map-file.js";
import { recoveryDocMeta } from "./recovery-map.js";
import { lastOfferedSeq, rememberOfferedSeq } from "./recovery-seq.js";
import { readAllRecoverySource } from "./recovery-source.js";
import { openSession } from "./session.js";
import { AGGREGATOR_HOSTS, suiRpcHost } from "./walrus.js";
/**
 * Where the bytes this list points at live, for the sealed self-description.
 *
 * ⚠ `aggregators` AND `chain_rpc` ARE HINTS. They are the endpoints this build reads from today —
 *   the first thing in the file to go stale — so a reader treats them as candidates AFTER its own
 *   built-in defaults, never as instructions. `chain` is the one that changes behaviour: a blob id
 *   from testnet and one from mainnet are the same kind of string, and without this a recovery has
 *   to try both and let a wrong guess look like missing bytes.
 */
function storageFor(network) {
    return {
        network: "walrus",
        chain: network,
        aggregators: [...(AGGREGATOR_HOSTS[network] ?? [])],
        chain_rpc: suiRpcHost(network),
    };
}
export async function assembleRecoveryList(options = {}) {
    // ⛔ BEFORE THE FIRST READ. Everything created from here on is outside this list.
    const capturedAt = new Date().toISOString();
    const session = await openSession({ server: options.server, network: options.network });
    const proof = await accountProofFor({ code: session.code, source: session.source });
    const list = await readFileList(session.server, session.apiKey, session.code, session.accountId);
    if (list.manifest === null) {
        throw new NmtsError("This account has no file list, so nothing can be described.", {
            exitCode: 4,
            nextStep: `Nothing was written. A recovery list says what each stored file is CALLED and which key ` +
                `opens it, and both come from the account's own file list — the storage network holds ` +
                `neither. Run \`${BINARY_NAME} rebuild\` if this account has stored files but no list.`,
        });
    }
    const source = await readAllRecoverySource({
        server: session.server,
        apiKey: session.apiKey,
        accountProof: proof,
        onProgress: options.onProgress,
    });
    const generatedAt = new Date().toISOString();
    const seq = lastOfferedSeq(session.accountId) + 1;
    const crypt = await loadCrypto();
    const derived = crypt.kdf_derive(crypt.account_code_parse(session.code));
    const [from, to] = DERIVED.dataKey;
    const dataKey = derived.slice(from, to);
    derived.fill(0);
    let built;
    try {
        built = buildRecoveryList({
            crypt,
            dataKey,
            accountId: session.accountId,
            entries: list.manifest.entries,
            source,
            seq,
            generatedAt,
            meta: recoveryDocMeta(artifactAbout("recovery-list"), storageFor(session.network)),
        });
    }
    finally {
        dataKey.fill(0);
    }
    return {
        session,
        proof,
        built,
        seq,
        capturedAt,
        file: buildRecoveryMapFile({
            accountId: session.accountId,
            seq,
            generatedAt,
            // ⛔ READ BACK OUT OF THE DOCUMENT, not assumed. From NRM-3 on the number a document declares
            //    depends on what is in it, and a wrapper that stated the newest version this build knows
            //    would mislabel every ordinary file.
            nrm: built.doc.v,
            sealed: built.sealed,
        }),
    };
}
/**
 * Tell the server a list was written, and what number it carries.
 *
 * ⛔ THE FILE FIRST, THE RECORD SECOND — so this takes the path that already exists. The record is
 *    what makes an account screen say "your list is up to date"; saying that before the file
 *    exists would be a claim about something that may never have been written.
 *
 * ⛔ `kind: "local"` AND NO BLOB ID. This tool keeps the list on the person's own disk and writes
 *    no copy to the storage network, and the server refuses a blob id alongside `local` for
 *    exactly that reason: a recorded address nothing was written to would let a screen advertise
 *    a copy that does not exist.
 *
 * ⛔ THE ATTEMPT IS REMEMBERED WHETHER OR NOT IT LANDS. See `recovery-seq.ts`: a number the server
 *    refused must not be the number the next run offers again, or the refusal repeats for ever.
 */
export async function recordRecoveryList(assembled, destination) {
    const { session, seq } = assembled;
    rememberOfferedSeq(session.accountId, seq);
    try {
        await request(session.server, "/v1/account/recovery-map", {
            method: "PUT",
            token: session.apiKey,
            accountProof: assembled.proof,
            body: { kind: "local", seq, captured_at: assembled.capturedAt },
        });
    }
    catch (error) {
        // ⛔ THE FILE IS GOOD AND THE RECORD IS NOT. Those are two different facts and the person needs
        //    both, so this neither swallows the failure nor pretends the run succeeded.
        if (error instanceof ServerError && error.code === "VERSION_CONFLICT") {
            throw new NmtsError(`The file was written, and the server did not record it: ${error.message}`, {
                exitCode: 4,
                nextStep: `${destination} IS usable — keep it. What did not happen is the note on the server that ` +
                    `says which list is newest, because this account already has one numbered ${seq} or ` +
                    `higher: a browser or another machine wrote one this machine has not seen. This run has ` +
                    `been remembered, so running the command again offers a higher number.`,
            });
        }
        throw error;
    }
}
