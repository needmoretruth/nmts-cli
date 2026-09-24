// `nmts put <file> --pay wallet` — one file in, sealed on this machine, its storage bought by the
// PERSON'S OWN WALLET on the storage network instead of by credits.
//
// ⛔ THE UPLOAD ITSELF IS NOT HERE. `upload-wallet-put.ts` prices, refuses, signs, pushes and
//    records; this file is the terminal around it — the arguments, the printed review, the wallet
//    agreement this machine holds, the spending ledger and the standing gift. The split is what
//    lets the SDK pay from a wallet without a second copy of the order that keeps money safe.
//
// ⛔ THE REVIEW IS PRINTED BEFORE ANY REFUSAL, and the agreement is asked for only after a known
//    shortfall has already stopped the run — so a person who cannot afford it reads the numbers
//    instead of a question. `--dry-run` stops at the review and never loads the signing module.
//
// ⛔ A HELD RESOURCE IS OFFERED, NEVER CHOSEN FOR THE PERSON — the owner's rule for storage
//    resources: the leftover is shown in bytes and the person decides. The review names how many
//    free resources the wallet holds; `--storage fit|whole|<id>` uses one and the review says in
//    bytes what is cut free or bound with the file.
import { basename, resolve } from "node:path";
import { identityOf } from "../account.js";
import { requireAccountCode } from "../code-access.js";
import { parseAsked } from "../collision.js";
import { loadCrypto } from "../crypto.js";
import { API_KEY_ENV_VAR, readCredentialsFile, resolveApiKey } from "../credentials.js";
import { NmtsError } from "../errors.js";
import { payingWalletIndex } from "../wallet-pay-index.js";
import { activeWalletOf } from "../shared/lib/drive/manifest-settings.js";
import { paddingRuleOf, readFileList } from "../manifest.js";
import { resolveNetwork } from "../network.js";
import { BINARY_NAME } from "../product.js";
import { Progress, silentSink } from "../progress.js";
import { stderrSink } from "../progress-node.js";
import { resolveServer } from "../server.js";
import { fileSource } from "../upload-file-node.js";
import { partSizeFor } from "../upload-price.js";
import { measureLocal } from "../upload-price-node.js";
import { downloadForRefill, findOriginal, settleRefill } from "../refill-source.js";
import { describeUploadReview } from "../upload-wallet-plan.js";
import { walletPut } from "../upload-wallet-put.js";
import { coinAmount } from "../wallet.js";
import { recordWalletSpend, requireWalletGrant } from "../wallet-grant.js";
import { folderIdFor } from "./put.js";
export async function putWithWallet(target, options) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    const from = options.from;
    refuseFromClashes(target, options);
    if (from === undefined && (target === undefined || target === "")) {
        throw new NmtsError("Say which file to put.", { exitCode: 2, nextStep: `\`${BINARY_NAME} put <file> --pay wallet\`` });
    }
    const resolved = await requireAccountCode();
    const key = resolveApiKey();
    if (key === null) {
        throw new NmtsError("This account has no API key on this machine, and the server needs one.", {
            exitCode: 3,
            nextStep: `Make a key on the account screen at nmts.me and put it in ${API_KEY_ENV_VAR}, or store it with \`${BINARY_NAME} login\`.`,
        });
    }
    // ⛔ MEASURED BEFORE A SINGLE NETWORK CALL, as it always was: a path that is not a file is a
    //    command line to fix, and finding that out after three chain reads wastes somebody's time.
    const local = from === undefined ? { localPath: resolve(target ?? ""), size: measureLocal(resolve(target ?? "")) } : null;
    const stored = readCredentialsFile();
    const server = resolveServer(options.server ?? stored?.server);
    const network = resolveNetwork(server, options.network ?? stored?.network);
    const identity = await identityOf(resolved.code);
    const crypt = await loadCrypto();
    const asked = parseAsked(options.onCollision);
    const list = await readFileList(server, key.key, resolved.code, identity.accountId);
    const rule = paddingRuleOf(list.manifest?.settings);
    // ⛔ WHICH WALLET PAYS, BEFORE ANYTHING IS PRICED — out of the list that was just read, so this
    //    costs no second request and the address in the review is the address that signs.
    const wallet = await payingWalletIndex({
        ...options,
        readActiveWallet: async () => activeWalletOf(list.manifest?.settings),
    });
    // ⛔ THE PLACE COMES FROM THE ORIGINAL, NOT FROM THE COMMAND LINE, when there is one: this
    //    replaces a file where it already sits, so its name and its folder are not open questions.
    const original = from === undefined ? null : findOriginal(list.manifest?.entries ?? [], from);
    const name = original?.name ?? options.name ?? basename(local?.localPath ?? "");
    const destination = original?.destination ?? (options.to ?? "").replace(/^\.?\//, "").replace(/\/$/, "");
    const parentId = original === null ? folderIdFor(options.to, list.manifest?.entries ?? []) : original.parentId;
    const ctx = {
        code: resolved.code,
        apiKey: key.key,
        server,
        network,
        accountId: identity.accountId,
        crypt,
        partSize: partSizeFor(options.partSize),
        rule,
        onCollision: asked,
        settings: list.manifest?.settings,
        wallet,
        networkCopy: options.json === true ? false : await readNetworkCopy(server, key.key),
        progress: new Progress(options.json === true ? silentSink() : stderrSink(), "uploading"),
        say,
        json: options.json === true,
    };
    // ⛔ NOTHING IS DOWNLOADED FOR A DRY RUN. The price is arithmetic over the size the sealed list
    //    already holds, and `walletPut` returns at the review before the source is read — so the
    //    empty path below can only be reached by a run that got past the review, which is this one.
    const scratch = original === null || options.dryRun === true ? null : await downloadForRefill({ server, apiKey: key.key, code: resolved.code, network, original });
    let done;
    try {
        const size = local?.size ?? original?.entry.size ?? 0;
        const localPath = local?.localPath ?? scratch?.localPath ?? "";
        done = await uploadOneWithWallet(ctx, { localPath, size, name, parentId, destination, thumbOf: options.thumbOf }, options);
    }
    finally {
        // ⛔ ON EVERY PATH OUT, INCLUDING THE FAILING ONES. What it removes is a decrypted copy of
        //    somebody's file; leaving one behind because a signature was refused is the worst case.
        scratch?.remove();
    }
    if (done === null)
        return 0;
    // ⛔ THE NAME AND THE TRASH, AFTER THE PAID-FOR BYTES ARE IN THE LIST. See `settleRefill` for why
    //    this is a second write rather than an overwrite on the commit.
    const settled = original === null
        ? null
        : await settleRefill({ server, apiKey: key.key, code: resolved.code, accountId: identity.accountId }, original, done.itemId);
    const savedAs = original?.name ?? done.savedAs;
    options.onStored?.(done.itemId, savedAs);
    if (options.json) {
        say(JSON.stringify({ id: done.itemId, name: savedAs, ...done.facts, resumed: done.resumed, renamed: savedAs !== name, ...(original !== null ? { replacedIntoTrash: original.entry.id } : done.replaced ? { replacedIntoTrash: done.replaced } : {}), fileListVersion: settled ?? done.seq }));
        return 0;
    }
    say(`  saved as ${savedAs}`);
    if (original !== null) {
        say(`  The file credits paid for is in the trash now — ${BINARY_NAME} restore brings it back for 30 days.`);
        say(`  Erasing it releases its storage and settles its deposit: ${BINARY_NAME} erase --release-storage.`);
    }
    else if (done.replaced)
        say(`  A file called ${name} was already there. It is in the trash now — ${BINARY_NAME} restore brings it back for 30 days.`);
    else if (done.savedAs !== name)
        say(`  A file called ${name} was already there, so this one was numbered rather than replacing it.`);
    if (done.resumed)
        say(`  This finished an upload a previous run had already signed for. Nothing was signed now.`);
    return 0;
}
/**
 * The options `--from` leaves no room for, refused before anything is read.
 *
 * ⛔ REFUSED RATHER THAN IGNORED, for the reason `put-payer.ts` refuses the wallet-only options:
 *    somebody who typed `--name` meant it, and an upload that quietly used a different name would
 *    be discovered as a file in the wrong place, after the money moved.
 */
function refuseFromClashes(target, options) {
    if (options.from === undefined)
        return;
    const nothing = `Nothing was signed and nothing was sent.`;
    const clash = (what, why) => new NmtsError(`${what} does not apply with --from: ${why}`, { exitCode: 2, nextStep: nothing });
    if (target !== undefined && target !== "") {
        throw clash(`a local file`, `--from names the file, in the drive, and one run re-uploads one file.`);
    }
    if (options.name !== undefined)
        throw clash(`--name`, `the re-upload keeps the name the file has.`);
    if (options.to !== undefined)
        throw clash(`--to`, `the re-upload keeps the folder the file is in.`);
    if (options.onCollision !== undefined) {
        throw clash(`--on-collision`, `a re-upload replaces the file it came from; that is what it is for.`);
    }
}
/**
 * Review, agree, upload and record ONE file for a person who is watching. Null when `--dry-run`
 * stopped at the review.
 *
 * ⛔ THE AGREEMENT HANDED IN BELOW IS THIS MACHINE'S GRANT, held against the total the review
 *    names. It is the one gate between a program and somebody's wallet, and the reason it is
 *    handed to the library rather than living inside it: a library call has nobody to ask.
 */
export async function uploadOneWithWallet(ctx, file, options) {
    const { say } = ctx;
    let outcome;
    try {
        outcome = await walletPut({
            code: ctx.code,
            apiKey: ctx.apiKey,
            server: ctx.server,
            network: ctx.network,
            accountId: ctx.accountId,
            crypt: ctx.crypt,
            wallet: ctx.wallet,
            partSize: ctx.partSize,
            rule: ctx.rule,
            onCollision: ctx.onCollision,
        }, { source: fileSource(file.localPath, file.size), name: file.name, parentId: file.parentId, destination: file.destination, thumbOf: file.thumbOf }, {
            epochs: options.epochs,
            storage: options.storage,
            dryRun: options.dryRun,
            readChain: options.readChain,
            sign: options.sign,
            protocol: options.protocol,
            api: options.api,
            onProgress: (sent, total) => ctx.progress.update(sent, total),
            onStep: (step) => tell(ctx, file.size, step),
            onReview: (review) => {
                if (ctx.json)
                    return;
                describeUploadReview(say, {
                    name: review.name,
                    bytes: review.bytes,
                    parts: review.parts,
                    epochs: review.epochs,
                    days: review.days,
                    endEpoch: review.endEpoch,
                    walNeeded: review.budget.walNeededFrost,
                    tipMist: review.tipMist,
                    storage: review.storage,
                    heldResources: review.heldResources,
                    networkCopy: ctx.networkCopy,
                }, review.budget);
            },
            agree: (review) => {
                requireWalletGrant("seal", { walFrost: review.budget.walNeededFrost, suiMist: review.budget.suiNeededMist }, new Date(options.now ?? Date.now()));
            },
            onSpend: recordWalletSpend,
        });
    }
    finally {
        ctx.progress.done();
    }
    const facts = factsOf(outcome.review);
    if (outcome.kind === "review") {
        if (ctx.json)
            say(JSON.stringify({ dryRun: true, name: outcome.review.name, ...facts, signed: false }));
        else {
            say(``);
            if (outcome.review.budget.shortfall !== null)
                say(`  ⚠ ${outcome.review.budget.shortfall} As it stands, it would be refused.`);
            say(`  Nothing was signed and nothing was sent. Run the same command without --dry-run to upload it.`);
        }
        return null;
    }
    // ⛔ THE STANDING SHARE, AFTER THE PAYMENT AND NEVER INSIDE IT: a gift that fails must not fail
    //    the upload. A resumed run paid nothing now, so it owes nothing now. In --json the tip speaks
    //    on stderr — stdout carries the machine's one answer and nothing else.
    await (await import("../standing-tip.js")).standingTipAfter({
        server: ctx.server,
        network: ctx.network,
        code: ctx.code,
        settings: ctx.settings,
        wallet: ctx.wallet,
        paidWalFrost: outcome.resumed ? 0n : outcome.review.budget.walNeededFrost,
        say: ctx.json ? (line) => void process.stderr.write(`${line}\n`) : say,
        trustServerAddress: options.trustServerTipAddress === true,
        ...(options.tip ?? {}),
    });
    return { itemId: outcome.itemId, savedAs: outcome.savedAs, replaced: outcome.replaced, seq: outcome.fileListVersion, resumed: outcome.resumed, facts };
}
/**
 * Whether this account asks its uploads to carry the recovery list's copy — for the review's one
 * sentence about it, and for nothing else.
 *
 * ⛔ A FAILED READ IS `null`, NOT A FAILED UPLOAD. What hangs on this is a sentence; a server that
 *    could not answer, or one older than the field, must not cost somebody the upload they asked
 *    for. `--json` skips the read entirely — there is no review to print.
 */
export async function readNetworkCopy(server, apiKey) {
    try {
        const { readAccountSummary } = await import("./balance.js");
        return (await readAccountSummary(server, apiKey)).network_copy;
    }
    catch {
        return null;
    }
}
/** The review as `--json` prints it: base units as strings, with the coin amounts beside them. */
function factsOf(review) {
    const { budget, storage } = review;
    return {
        bytes: review.bytes,
        sealedBytes: review.sealedBytes,
        parts: review.parts,
        epochs: review.epochs,
        days: review.days,
        endEpoch: review.endEpoch,
        paidFrom: "wallet",
        priceFrost: budget.walNeededFrost.toString(),
        priceWal: coinAmount(budget.walNeededFrost),
        tipMist: review.tipMist.toString(),
        tipSui: coinAmount(review.tipMist),
        feeMist: budget.feeMist === null ? null : budget.feeMist.toString(),
        feeSui: budget.feeMist === null ? null : coinAmount(budget.feeMist),
        wallet: budget.address,
        walletWal: budget.walFrost === null ? null : coinAmount(budget.walFrost),
        walletSui: budget.suiMist === null ? null : coinAmount(budget.suiMist),
        storage: storage.kind === "buy"
            ? { kind: "buy" }
            : { kind: "reuse", objectId: storage.objectId, cutToBytes: storage.cutToBytes, leftoverBytes: storage.leftoverBytes },
    };
}
/** Each step, for a person watching. The signatures are named as what they are. */
function tell(ctx, size, step) {
    if (ctx.json || step.step === "planning")
        return;
    const { say } = ctx;
    if (step.step === "hashing")
        return say(`  reading ${size} bytes`);
    const where = step.parts > 1 ? `  [${step.partIndex + 1}/${step.parts}]` : "";
    if (step.step === "sealing")
        say(`  sealing${where} ${step.bytes} bytes`);
    if (step.step === "resuming")
        say(`  picking up a part already ${step.state}${where}`);
    if (step.step === "encoding")
        say(`  preparing${where} ${step.bytes} sealed bytes`);
    if (step.step === "reserving")
        say(`  signing the registration${where} — WAL and the relay tip leave the wallet`);
    if (step.step === "uploading")
        say(`  uploading${where} ${step.bytes} bytes to ${step.relayUrl}`);
    if (step.step === "certifying") {
        ctx.progress.done();
        say(`  signing the certification${where} — gas only`);
    }
    if (step.step === "committing")
        say(`  saving to the drive`);
}
