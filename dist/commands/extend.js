// `nmts extend <path>` — buy more storage time for one file that is already stored.
//
// ⛔ THE ONLY COMMAND IN THIS TOOL THAT SIGNS ANYTHING, and the only one that spends from a
//    WALLET. Every other purchase here is made with credits, which are a promise this service
//    made; this one moves WAL out of the wallet the NMTS key derives, on a public chain, and
//    nobody — NMTS included — can reverse it. That difference is said out loud, in the output,
//    before the agreement is asked for.
//
// ⛔ IT PRICES BEFORE IT SPENDS, ALWAYS. The reads and the quote are free and happen first
//    (`planExtension`), so `--dry-run` answers with a real number and never reaches the key.
//    Nothing below the quote can run without `requireWalletGrant("extend", …)` having passed.
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
//
// ⚠ WHAT IS DECIDED HERE AND WHAT IS NOT. The reads, the arithmetic, the price, the balances, the
//   signature and the recording are `storage-control.ts`, which the SDK calls as well; this file is
//   the terminal over them — the sentences, the agreement, the standing gift and the exit code.
import { recordWalletSpend, requireWalletGrant } from "../wallet-grant.js";
import { NmtsError } from "../errors.js";
import { daysLeftInWords } from "../expiry.js";
import { describeBudget, shortfallNextStep } from "../extend-budget.js";
import { resolveNetwork } from "../network.js";
import { BINARY_NAME } from "../product.js";
import { openSession } from "../session.js";
import { applyExtension, planExtension } from "../storage-control.js";
import { walletIndexOf } from "../wallet-pay-index.js";
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
    // ⛔ A NUMBER THAT IS NOT ONE IS REFUSED BEFORE ANYTHING IS READ. Absent, the account's own number
    //    comes out of the sealed list the plan reads — one read, so the address that is priced and
    //    the address that signs cannot differ.
    const named = options.wallet === undefined || options.wallet === "" ? undefined : walletIndexOf(options.wallet);
    const plan = await planExtension(session, target, {
        now,
        epochs: options.epochs,
        wallet: named,
        readChain: options.readChain,
        // ⚠ THE LAST SENTENCE IS THIS FILE'S: `nmts get` is a command at a prompt.
        hints: {
            lapsed: `Nothing was signed and nothing was charged. A lease is extended before it ends — once it ` +
                `is over there is no storage object left to extend, and the bytes may already be gone. ` +
                `\`${BINARY_NAME} get\` says whether they can still be read.`,
        },
    });
    const { facts, budget } = plan;
    if (options.dryRun === true) {
        // ⛔ NOTHING BELOW THIS BRANCH RUNS. No key is derived for signing, no agreement is asked for,
        //    and the signing module is not even loaded — `--dry-run` is a price and nothing else.
        if (options.json) {
            say(JSON.stringify({ ...facts, dryRun: true, signed: false }));
            return 0;
        }
        describe(say, facts);
        describeBudget(say, budget);
        say(``);
        if (budget.shortfall !== null)
            say(`  ⚠ ${budget.shortfall} As it stands, it would be refused.`);
        say(`  Nothing was signed and nothing was charged. Run the same command without --dry-run to`);
        say(`  buy it.`);
        if (plan.stage === "later")
            say(`  It is not near its deadline, so buying it also needs --yes.`);
        return 0;
    }
    if (!options.json) {
        describe(say, facts);
        describeBudget(say, budget);
    }
    // ⛔ ASKED AFTER THE PRICE IS KNOWN AND BEFORE ANYTHING IS SIGNED. Extending early loses nothing,
    //    so this is not a refusal on principle — it is a refusal to spend on a deadline that is not
    //    close, unless somebody says otherwise out loud.
    if (plan.stage === "later" && options.yes !== true) {
        throw new NmtsError(`"${plan.path}" is not near the end of its storage term.`, {
            exitCode: 4,
            nextStep: `Nothing was signed and nothing was charged. Extending early loses nothing — the epochs ` +
                `are added to what is left — but it spends now for time this file does not need yet. ` +
                `Add --yes to buy it anyway. \`${BINARY_NAME} expiring\` lists what is actually running out.`,
        });
    }
    // ⛔ A WALLET KNOWN TO BE SHORT IS REFUSED BEFORE THE AGREEMENT IS ASKED FOR — a person should
    //    not grant signing in order to be told there is nothing to spend (`extend-budget.ts`).
    if (budget.shortfall !== null) {
        throw new NmtsError(budget.shortfall, { exitCode: 4, nextStep: shortfallNextStep(budget) });
    }
    // ⛔ THE ONE GATE THAT STANDS BETWEEN A PROGRAM AND SOMEBODY'S WALLET. Everything above this line
    //    is a read; nothing below it can be undone. The grant names a scope, runs out, and may carry
    //    a ceiling — this signature is held against all three (`wallet-grant.ts`).
    const spend = { walFrost: budget.priceFrost, suiMist: budget.feeMist ?? 0n };
    requireWalletGrant("extend", spend, new Date(now));
    const outcome = await applyExtension(session, plan, {
        sign: options.sign,
        // What left the wallet is added to the grant's ledger first — the fee as estimated, since the
        // amount actually charged is not read back here.
        onSigned: () => recordWalletSpend(spend),
    });
    if (!outcome.recorded) {
        if (options.json) {
            say(JSON.stringify({ ...facts, dryRun: false, signed: true, digest: outcome.digest, recorded: false }));
        }
        else {
            say(``);
            say(`  The storage IS extended and the payment has been made — transaction ${outcome.digest}.`);
            say(`  What failed is telling the NMTS server about it, so the drive will go on showing the`);
            say(`  old date until something tells it. ⛔ Do not run this command again for this file:`);
            say(`  that would buy the same epochs a second time. Opening the account in a browser reads`);
            say(`  the chain directly.`);
            say(`  Cause: ${outcome.notRecorded}`);
        }
        return 1;
    }
    if (options.json) {
        say(JSON.stringify({ ...facts, dryRun: false, signed: true, digest: outcome.digest, recorded: true, replay: outcome.replay }));
    }
    else {
        say(``);
        say(`  Extended. The storage now ends at epoch ${facts.newEndEpoch} — ${daysLeftInWords(facts.daysLeftAfter)}.`);
        say(`  Transaction ${outcome.digest}`);
        if (outcome.replay)
            say(`  The server had already recorded this transaction, so nothing was written twice.`);
    }
    // ⛔ AFTER THE PAYMENT, NEVER INSIDE IT, and it cannot change the answer above. In --json the
    //    tip speaks on stderr: stdout carries the machine's one answer and nothing else.
    await (await import("../standing-tip.js")).standingTipAfter({
        server: session.server,
        network: resolveNetwork(session.server, session.network),
        code: session.code,
        settings: plan.settings,
        wallet: plan.wallet,
        paidWalFrost: budget.priceFrost,
        say: options.json === true ? (line) => void process.stderr.write(`${line}\n`) : say,
        trustServerAddress: options.trustServerTipAddress === true,
        ...(options.tip ?? {}),
    });
    return 0;
}
/** What the numbers say, for a person, in the order somebody deciding needs them. */
function describe(say, facts) {
    const when = (epoch, left) => `epoch ${epoch} — ${daysLeftInWords(left)}`;
    const cohort = facts.filesOnTheSameBlobs;
    const unreachable = facts.partsThatCannotBeExtended;
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
    say(`  This is paid in WAL from the wallet this NMTS key derives — not from credits, which`);
    say(`  is what every other command in this tool spends. \`${BINARY_NAME} wallet\` shows what is in it.`);
}
