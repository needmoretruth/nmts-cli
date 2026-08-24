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
        },
        quota: { granted: num(quota["granted"], "quota.granted"), used: num(quota["used"], "quota.used") },
        storage: {
            parts: num(storage["parts"], "storage.parts"),
            earliest_expiry_epoch: typeof epoch === "number" ? epoch : null,
        },
        terms: { acceptance_required: isRecord(terms) && terms["acceptance_required"] === true },
    };
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
    say(`holding    ${humanSize(quota.used)} across ${plural(storage.parts, "stored piece", "stored pieces")}`);
    if (storage.earliest_expiry_epoch !== null) {
        say(`           the earliest lease ends at storage period ${storage.earliest_expiry_epoch} — ` +
            `\`${BINARY_NAME} expiring\` reads the clock and says when that is`);
    }
    if (summary.terms.acceptance_required) {
        say(``);
        say(`⛔ New terms are in force and this account has not accepted them.`);
        say(`   A person has to read and accept them in a browser; nothing here can do it.`);
    }
    return 0;
}
