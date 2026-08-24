// `nmts extend <path>` — buy more storage time for one file that is already stored.
//
// ⛔ THE ONLY COMMAND IN THIS TOOL THAT SIGNS ANYTHING, and the only one that spends from a
//    WALLET. Every other purchase here is made with credits, which are a promise this service
//    made; this one moves WAL out of the wallet the account code derives, on a public chain, and
//    nobody — NMTS included — can reverse it. That difference is said out loud, in the output,
//    before the agreement is asked for.
//
// ⛔ IT PRICES BEFORE IT SPENDS, ALWAYS. The reads and the quote are free and happen first, so
//    `--dry-run` answers with a real number and never reaches the key. Nothing below the quote can
//    run without `requireConsent("wallet")` having passed.
//
// ⛔ THE SERVER DOES NOT EXTEND ANYTHING, and this command is shaped by that. `POST
//    /v1/items/{id}/extended` means "record an extension the device already signed": the storage is
//    already bought by the time it is called, so a failure there is a failure to WRITE THE DATE
//    DOWN and is reported as itself. Saying "extension failed" would invite a second run, and a
//    second run pays again.
//
// ⛔ AND A FILE THAT IS NOT RUNNING OUT IS NOT EXTENDED BY ACCIDENT. Extending early loses nothing
//    — epochs are added to what is left — so this is not a refusal on principle; it is a refusal
//    to spend money on a deadline nobody is near, unless somebody says so with `--yes`.
import { requireConsent } from "../consent.js";
import { request } from "../api.js";
import { buildIndex, entryAt, fullPathOf, KIND_FILE, normalisePath } from "../drive-paths.js";
import { NmtsError } from "../errors.js";
import { daysLeftInWords, daysLeftUntilEpoch, stageOf, } from "../expiry.js";
import { asExtendPreview, chooseEpochs, headroom, soonestEnd, } from "../extend-plan.js";
import { isRecord } from "../guards.js";
import { readFileList } from "../manifest.js";
import { BINARY_NAME } from "../product.js";
import { openSession } from "../session.js";
import { coinAmount } from "../wallet.js";
export async function extend(target, options = {}) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    const now = options.now ?? Date.now();
    if (target === undefined || target === "") {
        throw new NmtsError("Say which file to extend.", {
            exitCode: 2,
            nextStep: `\`${BINARY_NAME} extend <path>\` — the path as \`${BINARY_NAME} ls\` prints it.`,
        });
    }
    const session = await openSession(options);
    const list = await readFileList(session.server, session.apiKey, session.code, session.accountId);
    if (list.manifest === null) {
        throw new NmtsError("This account has no file list, so there is nothing to extend.", { exitCode: 4 });
    }
    const entries = list.manifest.entries;
    const entry = entryAt(entries, normalisePath(target), {
        nothingHappened: "Nothing was signed and nothing was charged.",
    });
    if (entry.kind !== KIND_FILE) {
        throw new NmtsError(`No file at "${fullPathOf(buildIndex(entries), entry)}".`, {
            exitCode: 4,
            nextStep: "That is a folder. Nothing was signed and nothing was charged — storage is bought per " +
                "file, so this takes one file at a time.",
        });
    }
    const path = fullPathOf(buildIndex(entries), entry);
    // ⛔ THE SERVER SAYS WHICH BLOBS, AND NOTHING ELSE. Its `expiry_epoch` is client-reported and
    //    advisory; a command that spends money reads the chain's own answer below.
    const preview = asExtendPreview(await request(session.server, `/v1/items/${encodeURIComponent(entry.id)}/extend-preview`, {
        token: session.apiKey,
    }));
    if (preview.targets.length === 0) {
        throw new NmtsError(`Nothing on "${path}" can be extended from here.`, {
            exitCode: 4,
            nextStep: nothingToExtend(preview),
        });
    }
    const reads = await (options.readChain ?? defaultReads)(session.network);
    const window = await reads.readWindow();
    if (window === null) {
        // ⛔ Not "nothing needs extending". The two look identical from outside and mean opposite things.
        throw new NmtsError(`The ${session.network} storage network could not be read.`, {
            exitCode: 1,
            nextStep: `Nothing was signed and nothing was charged. Which epoch the network is in, and how far ` +
                `ahead it will sell, are facts only the chain has — this tool will not spend against a ` +
                `guess. Try again, or name a different Sui node in NMTS_SUI_RPC.`,
        });
    }
    const clock = window.clock;
    const leases = await reads.readLeases(preview.targets.map((t) => t.objectId));
    const endEpoch = soonestEnd(leases);
    if (endEpoch === null) {
        throw new NmtsError(`The chain holds no storage term for "${path}".`, {
            exitCode: 4,
            nextStep: nothingToExtend(preview),
        });
    }
    const stage = stageOf(clock, endEpoch, now);
    if (stage === "lapsed") {
        throw new NmtsError(`The storage term for "${path}" has already ended.`, {
            exitCode: 4,
            nextStep: `Nothing was signed and nothing was charged. A lease is extended before it ends — once it ` +
                `is over there is no storage object left to extend, and the bytes may already be gone. ` +
                `\`${BINARY_NAME} get\` says whether they can still be read.`,
        });
    }
    const epochs = chooseEpochs(options.epochs, headroom(leases, clock.current, window.maxAhead));
    const newEndEpoch = endEpoch + epochs;
    const before = daysLeftUntilEpoch(clock, endEpoch, now);
    const after = daysLeftUntilEpoch(clock, newEndEpoch, now);
    // ⛔ A COST THAT COULD NOT BE COMPUTED MUST NOT BECOME A COST OF ZERO. `quote` rejects rather
    //    than defaulting, and that rejection stops this run before the agreement is asked for.
    const frost = await reads.quote(leases, epochs);
    const cohort = Math.max(0, ...preview.targets.map((t) => t.sharedItems));
    const unreachable = preview.treasuryParts + preview.untrackedParts;
    const facts = {
        file: path,
        itemId: entry.id,
        network: session.network,
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
    };
    if (options.dryRun === true) {
        // ⛔ NOTHING BELOW THIS BRANCH RUNS. No key is derived, no agreement is asked for, and the
        //    signing module is not even loaded — `--dry-run` is a price and nothing else.
        if (options.json) {
            say(JSON.stringify({ ...facts, dryRun: true, signed: false }));
            return 0;
        }
        describe(say, facts, cohort, unreachable);
        say(``);
        say(`  Nothing was signed and nothing was charged. Run the same command without --dry-run to`);
        say(`  buy it.`);
        if (stage === "later")
            say(`  It is not near its deadline, so buying it also needs --yes.`);
        return 0;
    }
    if (!options.json)
        describe(say, facts, cohort, unreachable);
    // ⛔ ASKED AFTER THE PRICE IS KNOWN AND BEFORE ANYTHING IS SIGNED. Extending early loses nothing,
    //    so this is not a refusal on principle — it is a refusal to spend on a deadline that is not
    //    close, unless somebody says otherwise out loud.
    if (stage === "later" && options.yes !== true) {
        throw new NmtsError(`"${path}" is not near the end of its storage term.`, {
            exitCode: 4,
            nextStep: `Nothing was signed and nothing was charged. Extending early loses nothing — the epochs ` +
                `are added to what is left — but it spends now for time this file does not need yet. ` +
                `Add --yes to buy it anyway. \`${BINARY_NAME} expiring\` lists what is actually running out.`,
        });
    }
    // ⛔ THE ONE GATE THAT STANDS BETWEEN A PROGRAM AND SOMEBODY'S WALLET. Everything above this line
    //    is a read; nothing below it can be undone.
    requireConsent("wallet");
    const sign = options.sign ?? (await import("../extend-sign.js")).signExtension;
    const digest = await sign({
        network: session.network,
        code: session.code,
        objectIds: preview.targets.map((t) => t.objectId),
        epochs,
    });
    // From here the storage IS extended. Recording it is bookkeeping, and a failure to record must
    // never be reported as a failure to extend — that reading invites a second run, which pays again.
    let replay = false;
    try {
        const recorded = await request(session.server, `/v1/items/${encodeURIComponent(entry.id)}/extended`, { method: "POST", token: session.apiKey, body: { epochs, tx_digest: digest } });
        replay = isRecord(recorded) && recorded["replay"] === true;
    }
    catch (error) {
        if (options.json) {
            say(JSON.stringify({ ...facts, dryRun: false, signed: true, digest, recorded: false }));
        }
        else {
            say(``);
            say(`  The storage IS extended and the payment has been made — transaction ${digest}.`);
            say(`  What failed is telling the NMTS server about it, so the drive will go on showing the`);
            say(`  old date until something tells it. ⛔ Do not run this command again for this file:`);
            say(`  that would buy the same epochs a second time. Opening the account in a browser reads`);
            say(`  the chain directly.`);
            say(`  Cause: ${error instanceof Error ? error.message : String(error)}`);
        }
        return 1;
    }
    if (options.json) {
        say(JSON.stringify({ ...facts, dryRun: false, signed: true, digest, recorded: true, replay }));
        return 0;
    }
    say(``);
    say(`  Extended. The storage now ends at epoch ${newEndEpoch} — ${daysLeftInWords(after)}.`);
    say(`  Transaction ${digest}`);
    if (replay) {
        say(`  The server had already recorded this transaction, so nothing was written twice.`);
    }
    return 0;
}
/** What the numbers say, for a person, in the order somebody deciding needs them. */
function describe(say, facts, cohort, unreachable) {
    const when = (epoch, left) => `epoch ${epoch} — ${daysLeftInWords(left)}`;
    say(`${facts.file}`);
    say(`  Storage ends at ${when(facts.endEpoch, facts.daysLeft)}.`);
    say(`  Extending by ${facts.epochs} epoch${facts.epochs === 1 ? "" : "s"} moves that to ` +
        `${when(facts.newEndEpoch, facts.daysLeftAfter)}.`);
    say(`  Price ${facts.priceWal} WAL for ${facts.blobs} stored blob${facts.blobs === 1 ? "" : "s"} — ` +
        `storage only, because the writing was paid for when the file was uploaded.`);
    if (cohort > 1) {
        say(`  ${cohort} of this account's files sit on the storage this pays for, so the same payment ` +
            `extends all of them.`);
    }
    if (unreachable > 0) {
        say(`  ${unreachable} part${unreachable === 1 ? "" : "s"} of this file cannot be extended from here.`);
    }
    say(``);
    // ⛔ REQUIRED, AND IT COMES BEFORE THE AGREEMENT. Every other purchase in this tool spends
    //    credits; this one spends assets out of a wallet, and nobody can put them back.
    say(`  This is paid in WAL from the wallet this account code derives — not from credits, which`);
    say(`  is what every other command in this tool spends. \`${BINARY_NAME} wallet\` shows what is in it.`);
}
/** Why a file has nothing to extend, said as the two different things it can be. */
function nothingToExtend(preview) {
    const parts = [];
    if (preview.treasuryParts > 0) {
        parts.push(`${preview.treasuryParts} part${preview.treasuryParts === 1 ? " is" : "s are"} on storage NMTS ` +
            `paid for, which this account cannot extend`);
    }
    if (preview.untrackedParts > 0) {
        parts.push(`${preview.untrackedParts} part${preview.untrackedParts === 1 ? " has" : "s have"} no ` +
            `recorded storage object, so there is nothing to name on the chain`);
    }
    const why = parts.length === 0 ? "The server lists no storage object for it." : `${parts.join(", and ")}.`;
    return `Nothing was signed and nothing was charged. ${why} Opening the account in a browser shows what it is stored on.`;
}
/** The real chain reads. Imported only when no seam was supplied — it loads the storage SDK. */
async function defaultReads(network) {
    return (await import("../extend-chain.js")).extendReads(network);
}
