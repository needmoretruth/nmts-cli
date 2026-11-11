// Buying more storage time for one file that is already stored — worked out, signed and handed
// back rather than printed.
//
// ⛔ ONE IMPLEMENTATION, TWO CALLERS. `nmts extend` is a terminal over this: the sentences a person
//    reads, the agreement this machine keeps, the exit code. The SDK is somebody else's program and
//    needs the same act with none of those. What must not be written twice is the ORDER below,
//    because every step of it is about money that does not come back.
//
// ⛔ IT PRICES BEFORE IT SPENDS, ALWAYS. `planExtension` reads, judges and quotes; it holds no key
//    and signs nothing, so a caller that only wants a price never comes near `applyExtension`.
//
// ⛔ THE SERVER DOES NOT EXTEND ANYTHING. `POST /v1/items/{id}/extended` means "record an extension
//    the device already signed": the storage is bought by the time it is called, so a failure there
//    is a failure to WRITE THE DATE DOWN and comes back as itself. Reporting it as a failure to
//    extend would invite a second run, and a second run pays again.
//
// ⛔ AND THE CHAIN IS THE AUTHORITY ON WHEN A LEASE ENDS, not the server's `expiry_epoch`. The
//    server's answer is used for one thing: knowing WHICH blobs to ask the chain about.
//
// ⚠ Nothing here reaches for `node:`, and the chain and the signer are loaded only when no seam was
//   supplied.
import { request } from "../api.js";
import { buildIndex, entryAt, fullPathOf, KIND_FILE, normalisePath } from "../drive-paths.js";
import { NmtsError } from "../errors.js";
import { budgetFacts, readBudget } from "../extend-budget.js";
import { daysLeftUntilEpoch, stageOf } from "../expiry.js";
import { asExtendPreview, chooseEpochs, headroom, nothingToExtend, readWindowOrRefuse, soonestEnd, refuseUnheld, } from "../extend-plan.js";
import { isRecord } from "../guards.js";
import { readFileList } from "../manifest.js";
import { activeWalletOf } from "../shared/lib/drive/manifest-settings.js";
import { coinAmount, walletAddress } from "../wallet.js";
/**
 * Work out what extending this file would buy and what it would cost, without signing anything.
 *
 * ⛔ NO KEY IS DERIVED FOR SIGNING AND NO SIGNER IS LOADED. Everything here is a read, which is
 *    what lets a price be asked for without an agreement being asked for first.
 */
export async function planExtension(input, target, seams) {
    const list = await readFileList(input.server, input.apiKey, input.code, input.accountId);
    if (list.manifest === null) {
        throw new NmtsError("This account has no file list, so there is nothing to extend.", { exitCode: 4 });
    }
    const entries = list.manifest.entries;
    const settings = list.manifest.settings;
    const entry = entryAt(entries, normalisePath(target), {
        nothingHappened: "Nothing was signed and nothing was charged.",
    });
    if (entry.kind !== KIND_FILE) {
        throw new NmtsError(`No file at "${fullPathOf(buildIndex(entries), entry)}".`, {
            exitCode: 4,
            nextStep: "That is a folder. Nothing was signed and nothing was charged. Storage is bought per " +
                "file, so this takes one file at a time.",
        });
    }
    const path = fullPathOf(buildIndex(entries), entry);
    // ⛔ WHICH WALLET PAYS comes out of the list this run already read, before the price is measured
    //    against a balance: the address below is the one that will sign.
    const wallet = seams.wallet ?? activeWalletOf(settings);
    const address = seams.payer?.address ?? (await walletAddress(input.code, wallet));
    const reads = await (seams.readChain ?? defaultReads)(input.network);
    const item = await planItemExtension(input, { id: entry.id, label: path }, {
        reads,
        window: await readWindowOrRefuse(reads, input.network),
        address,
        epochs: seams.epochs,
        now: seams.now,
        hints: seams.hints,
    });
    return { ...item, path, wallet, settings };
}
/**
 * Plan one file's extension from its id. The NMTS server says which blobs, the chain says how long
 * each runs and who holds it, and the paying wallet's balances are read against the price.
 *
 * ⛔ NO NMTS KEY. This is what lets a business's server keep a user's files alive with the user's
 *    delegation token and its own wallet, while the key that opens the files stays on the user's
 *    device. The file is named by `item.label`: its path when a key opened the list, its id when
 *    nothing could.
 */
export async function planItemExtension(where, item, seams) {
    const path = item.label;
    // ⛔ THE SERVER SAYS WHICH BLOBS, AND NOTHING ELSE. Its `expiry_epoch` is client-reported and
    //    advisory; anything that spends money reads the chain's own answer below.
    const preview = asExtendPreview(await request(where.server, `/v1/items/${encodeURIComponent(item.id)}/extend-preview`, {
        token: where.apiKey,
    }));
    if (preview.targets.length === 0) {
        throw new NmtsError(`EXTEND_NOTHING: nothing on "${path}" can be extended from here.`, {
            exitCode: 4,
            nextStep: nothingToExtend(preview),
        });
    }
    const { reads, window } = seams;
    const clock = window.clock;
    const objectIds = preview.targets.map((t) => t.objectId);
    const leases = await reads.readLeases(objectIds);
    const endEpoch = soonestEnd(leases);
    if (endEpoch === null) {
        throw new NmtsError(`The chain holds no storage term for "${path}".`, {
            exitCode: 4,
            nextStep: nothingToExtend(preview),
        });
    }
    const stage = stageOf(clock, endEpoch, seams.now);
    if (stage === "lapsed") {
        throw new NmtsError(`EXTEND_LAPSED: the storage term for "${path}" has already ended.`, {
            exitCode: 4,
            nextStep: seams.hints?.lapsed ??
                `Nothing was signed and nothing was charged. A lease is extended before it ends. Once it ` +
                    `is over there is no storage object left to extend, and the bytes may already be gone. ` +
                    `Fetching the file is what says whether they can still be read.`,
        });
    }
    // ⛔ BEFORE THE PRICE AND BEFORE ANY SIGNATURE: a blob this wallet does not hold cannot be
    //    extended by it, and the chain would only say so after somebody had been asked to sign.
    refuseUnheld(leases, seams.address, path);
    const epochs = chooseEpochs(seams.epochs, headroom(leases, clock.current, window.maxAhead));
    const newEndEpoch = endEpoch + epochs;
    const before = daysLeftUntilEpoch(clock, endEpoch, seams.now);
    const after = daysLeftUntilEpoch(clock, newEndEpoch, seams.now);
    // ⛔ A COST THAT COULD NOT BE COMPUTED MUST NOT BECOME A COST OF ZERO. `quote` rejects rather
    //    than defaulting, and that rejection stops this run before anything is agreed to.
    const frost = await reads.quote(leases, epochs);
    const cohort = Math.max(0, ...preview.targets.map((t) => t.sharedItems));
    const unreachable = preview.treasuryParts + preview.untrackedParts;
    const budget = await readBudget(reads, { address: seams.address, objectIds, epochs, priceFrost: frost });
    return {
        facts: {
            file: path,
            itemId: item.id,
            network: where.network,
            epoch: clock.current,
            endEpoch,
            epochs,
            newEndEpoch,
            daysLeft: before,
            daysLeftAfter: after,
            blobs: leases.length,
            priceFrost: frost.toString(),
            priceWal: coinAmount(frost),
            paidFrom: "wallet",
            filesOnTheSameBlobs: cohort,
            partsThatCannotBeExtended: unreachable,
            ...budgetFacts(budget),
        },
        itemId: item.id,
        objectIds,
        bytes: leases.reduce((sum, lease) => sum + lease.size, 0),
        epochs,
        stage,
        budget,
    };
}
/**
 * Buy it. ⛔ THIS SIGNS, and nothing below this line can be undone by anybody, NMTS included.
 *
 * Nothing here asks whether the caller meant it: the price, both balances and any shortfall are in
 * the plan, and calling this is the answer.
 */
export async function applyExtension(input, plan, seams = {}) {
    const sign = seams.sign ?? (await import("../wallet-sign.js")).signExtension;
    const digest = await sign({
        network: input.network,
        code: input.code,
        wallet: plan.wallet,
        objectIds: plan.objectIds,
        epochs: plan.epochs,
    });
    seams.onSigned?.(digest);
    return recordExtension(input, plan, digest);
}
/**
 * Tell the NMTS server about an extension that is already signed and paid for.
 *
 * From here the storage IS extended. Recording it is bookkeeping, and a failure to record must
 * never be reported as a failure to extend — that reading invites a second run, which pays again.
 */
export async function recordExtension(where, plan, digest) {
    try {
        const recorded = await request(where.server, `/v1/items/${encodeURIComponent(plan.itemId)}/extended`, { method: "POST", token: where.apiKey, body: { epochs: plan.epochs, tx_digest: digest } });
        return { digest, recorded: true, replay: isRecord(recorded) && recorded["replay"] === true, notRecorded: null };
    }
    catch (error) {
        return {
            digest,
            recorded: false,
            replay: false,
            notRecorded: error instanceof Error ? error.message : String(error),
        };
    }
}
/** The real chain reads. Imported only when no seam was supplied — it loads the storage SDK. */
export async function defaultReads(network) {
    return (await import("../extend-chain.js")).extendReads(network);
}
