// `nmts balance` — what this account can still pay for.
//
// ⛔ WHY IT EXISTS AT ALL. Until 2026-08-24 this tool could quote the price of an upload and then
//    spend, and had no way to say "you have one credit left". The only route that reported a
//    balance also carried the verb that erases the account, so a key could not reach the number
//    without being able to reach that — and it correctly could not. The answer was a route that
//    reads and can do nothing else; this is the command that calls it.
//
// ⚠ IT ASKS THE SERVER, UNLIKE `usage`. `usage` adds up the sealed file list, which is the
//   account's own record of what exists. This is the ledger, which only the server holds. They
//   answer different questions and neither substitutes for the other: one is "what do I have",
//   the other is "what can I still buy".
//
// ⛔ IT DOES NOT READ THE CHAIN, so it does not say when stored files expire — it reports the
//    number the server holds and names the command that does read the clock. Two commands
//    printing a storage deadline from two different sources is how they come to disagree.
import { request } from "../api.js";
import { isRecord } from "../guards.js";
import { NmtsError } from "../errors.js";
import { BINARY_NAME } from "../product.js";
import { openSession } from "../session.js";
import { humanSize } from "../units.js";
function num(value, field) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new NmtsError(`The server's answer had no usable \`${field}\`.`, {
            nextStep: "Update this tool, or read the account screen in a browser.",
        });
    }
    return value;
}
function asSummary(value) {
    if (!isRecord(value))
        throw new NmtsError("The server's answer was not an object.");
    const credits = value["credits"];
    const quota = value["quota"];
    const storage = value["storage"];
    const terms = value["terms"];
    if (!isRecord(credits) || !isRecord(quota) || !isRecord(storage)) {
        throw new NmtsError("The server described this account in a shape this version cannot read.", {
            nextStep: `Update this tool — \`npm install -g ${BINARY_NAME}\` — or read it in a browser.`,
        });
    }
    const expiry = credits["soonest_expiry"];
    const epoch = storage["earliest_expiry_epoch"];
    return {
        credits: {
            remaining: num(credits["remaining"], "credits.remaining"),
            soonest_expiry: typeof expiry === "string" ? expiry : null,
            file_cap: num(credits["file_cap"], "credits.file_cap"),
            daily_cap: num(credits["daily_cap"], "credits.daily_cap"),
            // Deposits arrived with the server that returns them; an older server simply has none.
            held: typeof credits["held"] === "number" ? credits["held"] : 0,
            deposits: typeof credits["deposits_held"] === "number" ? credits["deposits_held"] : 0,
            // ⛔ THE SERVER'S TWO NUMBERS, or none. A build that filled these in from a constant of its
            //    own would print what it believes rather than what the ledger will do, which is exactly
            //    the mistake the two ceilings above are read this way to avoid.
            deposit_max: typeof credits["deposit_max"] === "number" ? credits["deposit_max"] : 0,
            deposit_default: typeof credits["deposit_default"] === "number" ? credits["deposit_default"] : 0,
        },
        quota: { granted: num(quota["granted"], "quota.granted"), used: num(quota["used"], "quota.used") },
        storage: {
            parts: num(storage["parts"], "storage.parts"),
            earliest_expiry_epoch: typeof epoch === "number" ? epoch : null,
        },
        terms: { acceptance_required: isRecord(terms) && terms["acceptance_required"] === true },
        ai_account: value["ai_account"] === true,
        deposits: depositRows(credits["deposits"]),
    };
}
/**
 * The per-file deposit rows, when the answer carries them.
 *
 * ⛔ ABSENCE IS NOT ZERO ROWS DRESSED UP. The narrow read this command makes answers with the two
 *    totals and no list, so nothing is printed rather than a list claiming this account has no
 *    deposits. A row this version cannot read is dropped for the same reason: a file whose
 *    set-aside is a string is a file this build cannot say anything true about.
 */
function depositRows(value) {
    if (!Array.isArray(value))
        return [];
    const rows = [];
    for (const row of value) {
        if (!isRecord(row))
            continue;
        const set = row["deposit_credits"];
        const spent = row["spent_credits"];
        if (typeof set !== "number" || typeof spent !== "number")
            continue;
        rows.push({ deposit_credits: set, spent_credits: spent });
    }
    return rows;
}
function plural(n, one, many) {
    return `${n} ${n === 1 ? one : many}`;
}
export async function balance(options = {}) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    const session = await openSession({ server: options.server, network: options.network });
    const summary = asSummary(await request(session.server, "/v1/account/summary", { token: session.apiKey }));
    if (options.json === true) {
        say(JSON.stringify(summary));
        return 0;
    }
    const { credits, quota, storage } = summary;
    // ⛔ FIRST, AND NOT UNDER THE NUMBERS. Whoever is reading has to know WHICH account these
    //    figures belong to before they mean anything: an AI account has its own key, its own wallet
    //    and its own empty drive, so "nothing here" is the ordinary answer rather than a loss.
    if (summary.ai_account) {
        say(`AI account (not the main account)`);
        say(``);
    }
    say(`credits    ${plural(credits.remaining, "credit", "credits")}`);
    // ⛔ SAID AS BYTES TOO, because "one credit" means nothing until you know what it buys. It is the
    //    same number, not a second one — the server derives it from the same ledger read.
    say(`           = about ${humanSize(quota.granted)} for one lease period`);
    if (credits.soonest_expiry !== null) {
        // ⚠ THIS IS THE CREDITS EXPIRING, NOT THE FILES. A granted credit has its own life; storage
        //   already bought is not touched when one lapses.
        say(`           soonest to lapse unused: ${credits.soonest_expiry}`);
    }
    say(`ceilings   ${credits.file_cap} per file · ${credits.daily_cap} per day`);
    if (credits.held > 0) {
        // Tied up, not spent: each credit-paid file puts a deposit down, returned when its period ends.
        say(`deposits   ${plural(credits.held, "credit", "credits")} held on ${plural(credits.deposits, "stored file", "stored files")} — back when the storage period ends`);
        // ⚠ Per file, and what has already gone out of it. A deposit is spent a fee at a time, so
        //   "set aside" and "spent" are two different numbers about the same file.
        for (const row of summary.deposits) {
            say(`           ${row.deposit_credits} set aside · ${row.spent_credits} spent`);
        }
    }
    if (credits.deposit_max > 0) {
        say(`           an upload sets ${credits.deposit_default} aside by default — ` +
            `0 to ${credits.deposit_max}, \`${BINARY_NAME} deposit\` or --deposit for one upload`);
    }
    say(`holding    ${humanSize(quota.used)} across ${plural(storage.parts, "stored piece", "stored pieces")}`);
    if (storage.earliest_expiry_epoch !== null) {
        say(`           the earliest lease ends at storage period ${storage.earliest_expiry_epoch} — ` +
            `\`${BINARY_NAME} expiring\` reads the clock and says when that is`);
    }
    if (summary.terms.acceptance_required) {
        say(``);
        say(`⛔ New terms are in force and this account has not accepted them.`);
        say(`   A person reads and accepts them — \`${BINARY_NAME} accept-terms\` here, or in a browser.`);
    }
    return 0;
}
