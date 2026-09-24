// Erasing files for good, without a terminal: the targets resolved, the treasury's storage let go,
// the server's records destroyed and the entries taken out of the sealed list — decided, done and
// handed back rather than printed.
//
// ⛔ ONE IMPLEMENTATION, TWO CALLERS, WHICH IS THE WHOLE REASON THIS FILE EXISTS — the argument
//    `drive-edit.ts` makes one verb family over. `commands/erase.ts` is a terminal's shape: it
//    prints the list, asks for the typed sentence and answers an exit code. The SDK is somebody
//    else's program and needs the same act with none of those. A second implementation of "what
//    order do these three destructions happen in" would be a second place for the rules below to
//    be got right, and the copy nobody re-reads is the one that quietly disagrees — about the one
//    verb in this package that nothing can undo.
//
// ⛔ NOTHING HERE WRITES TO A STREAM, PICKS AN EXIT CODE OR ASKS ANYBODY ANYTHING. The confirmation
//    is the caller's: a terminal types a sentence, a program passes one. This file is reached only
//    after somebody decided, and it destroys what it is given.
//
// ⛔ THE SERVER GOES FIRST AND THE LIST LAST, which is the order the trash keeps and for the same
//    reason: a row erased before its list entry leaves a file the person can see and never open.
//    A release that FAILS stops the run before a single row is touched — nothing is erased behind
//    one. A release the server REFUSES ("that storage was bought by the wallet, not by credits")
//    is an answer rather than a failure: it is reported on that file and the erase goes on.
//
// ⛔ THE PROOF IS THE CALLER'S TO BUILD AND IS NOT DERIVED HERE. Both doors ask for the account
//    code's own proof, and WHETHER this run may make one is a policy question with two different
//    answers — the command line asks for an agreement first (`account-proof.ts`), a library caller
//    has already made that decision by calling. So it arrives as a value. Nothing here reaches for
//    `node:`: the SDK's browser entry bundles what this exports.
//
// ⚠ THE PIECES IT BORROWS COME FROM `drive-edit/` DIRECTLY, the way that folder's own files borrow
//   from each other. This is a sibling of that family rather than an outside caller.
import { request, ServerError } from "./api.js";
import { DriveEditError, resolving } from "./drive-edit/errors.js";
import { filesUnder, foldersUnder, uniqueById, withPreviews } from "./drive-edit/tree.js";
import { buildIndex, fullPathOf, KIND_FILE } from "./drive-paths.js";
import { NmtsError } from "./errors.js";
import { readFileList } from "./manifest.js";
import { applyToList, batchTargets } from "./manifest-write.js";
import { BINARY_NAME } from "./product.js";
/** The server takes at most this many ids in one erase (`ERASE_BATCH_MAX`). */
const BATCH = 200;
/** The refusal a no-deposit release gets when the balance cannot cover the doubled fee. */
const FEE_INSUFFICIENT = "DEPOSIT_FEE_INSUFFICIENT";
/**
 * Work out what erasing these paths would destroy, without destroying anything.
 *
 * ⛔ ITS OWN STEP BECAUSE ONE CALLER HAS TO SHOW THE LIST BEFORE IT ASKS. `nmts erase` prints every
 *    file it is about to destroy and then waits for a typed sentence; folding this into the act
 *    would leave the terminal with nothing to print, and reading the list twice would leave the
 *    two reads free to disagree about what is in it.
 */
export async function planErase(input, paths) {
    const list = await readFileList(input.server, input.apiKey, input.code, input.accountId);
    const entries = list.manifest?.entries ?? [];
    const index = buildIndex(entries);
    const targets = resolving(() => batchTargets(entries, paths, { includeTrashed: true, nothingHappened: "Nothing was erased." }));
    const files = withPreviews(entries, targets.flatMap((t) => (t.kind === KIND_FILE ? [t] : filesUnder(entries, t.id))));
    // ⛔ AND THE FOLDERS UNDER A NAMED FOLDER, which `targets + files` left behind. A sub-folder
    //    holding no file was in neither set, so it stayed in the sealed list with its parent gone —
    //    a folder the drive still showed, sitting under nothing, that no command could reach
    //    (2026-09-20). What is erased on the server is unchanged: folders have no row there.
    const folders = uniqueById(targets.flatMap((t) => (t.kind === KIND_FILE ? [] : foldersUnder(entries, t.id))));
    const going = uniqueById([...targets, ...files, ...folders]);
    if (files.length === 0) {
        throw new DriveEditError("NOT_FOUND", `Nothing named holds a file; empty folders are removed with \`${BINARY_NAME} rm\`.`, {
            exitCode: 4,
        });
    }
    return {
        files: files.map((f) => ({ id: f.id, path: fullPathOf(index, f) })),
        going: going.map((e) => e.id),
    };
}
/**
 * Destroy what the plan names. ⛔ Irreversible, and nothing below asks whether the caller meant it.
 */
export async function eraseFiles(input, plan, options = {}) {
    const releases = [];
    if (options.releaseStorage === true) {
        for (const f of plan.files) {
            const path = f.path;
            try {
                const reply = await request(input.server, `/v1/items/${encodeURIComponent(f.id)}/release-storage`, {
                    method: "POST",
                    body: {},
                    token: input.apiKey,
                    accountProof: input.accountProof,
                });
                releases.push({ path, refused: null, ...counts(reply), ...fee(reply) });
            }
            catch (error) {
                // ⛔ THE ONE REFUSAL THAT STOPS THE RUN. A file with no deposit pays twice the chain fee
                //    out of the balance, and a balance that cannot cover it means the release did not
                //    happen — erasing behind it would destroy the account's key to bytes that are still
                //    being served and still being paid for. Nothing is erased, and the two numbers say
                //    exactly how far short the balance is.
                if (error instanceof ServerError && error.code === FEE_INSUFFICIENT) {
                    throw new NmtsError(`${path}: releasing its storage costs ${amount(error, "needed_credits")} credits and this ` +
                        `account has ${amount(error, "balance_credits")}. It has no deposit, so the fee comes out of the balance.`, {
                        exitCode: 4,
                        nextStep: `Nothing was erased. Buy credits and run this again, or leave --release-storage off ` +
                            `to erase the file and let its storage run out on its own.`,
                    });
                }
                // ⚠ "Not ours to destroy" is an answer, not a failure: the storage was bought by the
                //   wallet, and the erase goes on. A refusal of the KEY or the proof, and anything the
                //   server could not do, stops the run before a row is touched.
                if (error instanceof ServerError && error.status !== 401 && error.status !== 403 && error.status < 500) {
                    releases.push({ path, released: 0, alreadyReleased: 0, failed: 0, feeCredits: 0, fromDeposit: false, refused: error.message });
                    continue;
                }
                throw error;
            }
        }
    }
    let erased = 0;
    for (let i = 0; i < plan.files.length; i += BATCH) {
        const reply = await request(input.server, "/v1/items/erase", {
            method: "POST",
            body: { item_ids: plan.files.slice(i, i + BATCH).map((f) => f.id) },
            token: input.apiKey,
            accountProof: input.accountProof,
        });
        erased += typeof reply === "object" && reply !== null && typeof Reflect.get(reply, "erased") === "number"
            ? Number(Reflect.get(reply, "erased"))
            : 0;
    }
    // ⛔ THE LIST GOES LAST, and re-decided against the list as it is on this attempt: only the
    //    ids this run erased leave it, whatever another device wrote in between.
    const ids = new Set(plan.going);
    const result = await applyToList(input, (current) => {
        const still = current.filter((e) => ids.has(e.id)).map((e) => e.id);
        return still.length === 0 ? null : { op: "purge", ids: still };
    });
    return { erased, files: [...plan.files], releases, seq: result.seq };
}
/**
 * Resolve these paths and destroy what they name, in one call.
 *
 * ⚠ FOR A CALLER THAT HAS ALREADY DECIDED. Anything that shows a person what is about to go should
 *   use `planErase` first, so what it shows is what it then destroys.
 */
export async function erasePaths(input, paths, options = {}) {
    return eraseFiles(input, await planErase(input, paths), options);
}
/** The three counts a release answers with, read defensively. */
function counts(reply) {
    const n = (name) => {
        const v = typeof reply === "object" && reply !== null ? Reflect.get(reply, name) : undefined;
        return typeof v === "number" ? v : 0;
    };
    return { released: n("released"), alreadyReleased: n("already_released"), failed: n("failed") };
}
/** What it cost, read the same defensive way. An older server says neither, which reads as 0. */
function fee(reply) {
    const at = (name) => typeof reply === "object" && reply !== null ? Reflect.get(reply, name) : undefined;
    const charged = at("fee_credits");
    return {
        feeCredits: typeof charged === "number" ? charged : 0,
        fromDeposit: at("from_deposit") === true,
    };
}
/** One credit amount out of a refusal's details, or `?` when the server did not name it. */
function amount(error, field) {
    const value = error.details[field];
    return typeof value === "number" ? String(value) : "?";
}
