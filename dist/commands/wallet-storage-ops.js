// `nmts wallet storage split|merge|transfer` — reshaping the storage resources the wallet holds,
// and handing one over. ⛔ EACH SIGNS. What the contract allows, what a change would leave behind,
// the dry run that prices it and the signature are `storage-control.ts`, which the SDK calls as
// well; this file is the terminal over it: the words typed, the review read, and `--yes`.
//
// ⛔ THE ORDER IS THE SAFETY, and it is kept over there: ① the resources are READ from the chain and
//    the named ones must be this wallet's ② the rules judge the request and say why not ③ the exact
//    transaction is dry-run for its fee, and a refusal there ends the run ④ the review ⑤ without
//    `--yes` that is the end ⑥ the wallet unlock is held against the fee — scope `storage` for
//    cutting and joining, scope `all` for handing over ⑦ only then the signature. Steps ⑤ and ⑥ are
//    this file's, handed in as the gate.
//
// ⛔ HANDING OVER MOVES NO FILE. The owner's sentence for the browser holds here: what goes is size
//    and remaining time; a file's bytes are sealed with keys the NMTS key derives and stay
//    unreadable to whoever receives the resource. It cannot be undone and NMTS cannot recall it.
import { requireAccountCode } from "../code-access.js";
import { readCredentialsFile } from "../credentials.js";
import { NmtsError } from "../errors.js";
import { resolveNetwork } from "../network.js";
import { BINARY_NAME } from "../product.js";
import { resolveServer } from "../server.js";
import { reshapeStorage, } from "../storage-control.js";
import { explorerTxUrl } from "../shared/lib/wallet/activity.js";
import { coinAmount, walletAddress } from "../wallet.js";
import { payingWalletIndex } from "../wallet-pay-index.js";
import { recordWalletSpend, requireWalletGrant } from "../wallet-grant.js";
import { formatBytes } from "./wallet-storage.js";
export async function walletStorageOps(op, rest, options = {}) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    const resolved = await requireAccountCode();
    // ⛔ WHICH WALLET, FIRST — the resources are read from this address, the review names it, and the
    //    same wallet signs; a resource is reshaped by the wallet that holds it and by no other.
    const wallet = await payingWalletIndex(options);
    const address = await walletAddress(resolved.code, wallet);
    const stored = resolved.source === "file" || resolved.source === "file-locked" ? readCredentialsFile() : null;
    const server = resolveServer(options.server ?? stored?.server);
    const network = resolveNetwork(server, options.network ?? stored?.network);
    // What was typed, as values. Everything past this is judged against the chain's own answer.
    const { ask, command } = asked(op, rest, options);
    // ⛔ WITHOUT `--yes` THE RUN STOPS AT THE REVIEW, exactly as `--dry-run` does — the two differ
    //    only in what is said afterwards and in the exit code, which is this file's business.
    const stopAtReview = options.dryRun === true || options.yes !== true;
    const outcome = await reshapeStorage({ network, code: resolved.code, wallet, address }, ask, {
        reads: options.storageReads,
        sign: options.signStorage,
        dryRun: stopAtReview,
        // ⚠ THE SENTENCES A PERSON READS ARE THIS FILE'S. The library judges; what a refusal calls
        //   the thing that was wrong — a flag, another command — belongs where somebody typed it.
        hints: {
            cannotRead: "Nothing was signed.",
            notHeld: `\`${BINARY_NAME} wallet storage\` lists the ones it holds. A resource bound inside a file is not free.`,
            cut: (what, limit) => new NmtsError(what === "size"
                ? `--size must be above 0 and below the resource's ${limit}.`
                : `--epochs must be a whole number above 0 and below the resource's ${limit} epochs.`, { exitCode: 2 }),
        },
        onReview: (review) => {
            if (!options.json)
                describe(say, review, wallet);
        },
        // ⑥ The unlock, held against the fee this review measured. ⛔ Throwing here signs nothing.
        agree: (review) => {
            requireWalletGrant(review.plan.action, spendOf(review), new Date(options.now ?? Date.now()));
        },
    });
    const { review } = outcome;
    const facts = {
        op,
        network,
        address,
        shape: review.plan.shape,
        feeSui: review.feeMist === null ? null : coinAmount(review.feeMist),
        currentEpoch: review.currentEpoch,
    };
    if (outcome.kind === "review") {
        if (options.json) {
            say(JSON.stringify({ ...facts, signed: false, dryRun: options.dryRun === true }));
            return options.dryRun === true ? 0 : 4;
        }
        say(``);
        if (options.dryRun === true) {
            say(`  Nothing was signed. Run the same command with --yes to do it.`);
            return 0;
        }
        throw new NmtsError(`Nothing was signed: this needs --yes.`, {
            exitCode: 4,
            nextStep: `Read the review above, then: \`${command} --yes\``,
        });
    }
    // What left the wallet is added to this machine's ledger as the dry run measured it.
    recordWalletSpend(spendOf(review));
    if (options.json) {
        say(JSON.stringify({ ...facts, signed: true, digest: outcome.digest, explorerUrl: explorerTxUrl(outcome.digest, network) }));
        return 0;
    }
    say(``);
    say(`  Done. Transaction ${outcome.digest}`);
    say(`  ${explorerTxUrl(outcome.digest, network)}`);
    say(`  \`${BINARY_NAME} wallet storage\` lists what the wallet holds now.`);
    return 0;
}
/** What one change costs this wallet: no WAL, and the fee the dry run measured. */
function spendOf(review) {
    return { walFrost: 0n, suiMist: review.feeMist ?? 0n };
}
/** The review a person reads, in the order somebody deciding needs it. */
function describe(say, review, wallet) {
    const { plan } = review;
    say(`Would ${what(plan)}`);
    say(`  from  ${review.address} (wallet ${wallet})`);
    for (const line of detail(plan))
        say(`  ${line}`);
    say(review.feeMist === null
        ? `  Chain fee (SUI): could not be measured just now; it is charged with the signature.`
        : `  Chain fee about ${coinAmount(review.feeMist)} SUI, measured by a dry run just now.`);
    if (plan.op === "transfer") {
        say(`  ⛔ No file goes with it. What goes is size and remaining time; the files stay sealed with this`);
        say(`     account's keys. It cannot be undone, and NMTS cannot recall it. Check the address once more.`);
    }
}
/** The one-line "what this would do", from the resources as the chain has them. */
function what(plan) {
    const named = (at) => {
        const r = plan.named[at];
        return r === undefined ? "" : `${formatBytes(r.sizeBytes)} · epoch ${r.startEpoch} to ${r.endEpoch} (${r.objectId})`;
    };
    const result = plan.result;
    if (result.kind === "split")
        return `cut ${named(0)} by ${plan.shape.kind === "splitSize" ? "size" : "period"}.`;
    if (result.kind === "merge")
        return `join ${named(1)} into ${named(0)}.`;
    return `hand ${named(0)} to ${result.to}.`;
}
/** What it would leave behind, said from the numbers the plan worked out. */
function detail(plan) {
    const result = plan.result;
    if (result.kind === "split") {
        const { keeps, creates } = result;
        return plan.shape.kind === "splitSize"
            ? [`It keeps ${formatBytes(keeps.sizeBytes)}; a new resource of ${formatBytes(creates.sizeBytes)} over the same period appears in this wallet.`]
            : [`It keeps epoch ${keeps.startEpoch} to ${keeps.endEpoch}; a new resource of the same size over epoch ${creates.startEpoch} to ${creates.endEpoch} appears in this wallet.`];
    }
    if (result.kind === "merge") {
        const b = result.becomes;
        return [
            result.how === "amount"
                ? `Same period, so the sizes add: the first becomes ${formatBytes(b.sizeBytes)} and the second is gone.`
                : `Same size and touching periods, so the periods join: the first spans epoch ${b.startEpoch} to ${b.endEpoch} and the second is gone.`,
        ];
    }
    return [`Afterwards this wallet no longer holds it.`];
}
/** What was typed, as the values the library judges — and the line to run to go through with it. */
function asked(op, rest, options) {
    const [a, b] = rest;
    if (op === "split") {
        if (a === undefined)
            throw usage("split <resource id> --size <bytes> | --epochs <n>");
        if (options.size !== undefined && options.epochs !== undefined)
            throw usage("split takes --size OR --epochs, not both");
        if (options.size !== undefined) {
            return {
                ask: { kind: "splitSize", objectId: a, keepBytes: parseBytes(options.size) },
                command: `${BINARY_NAME} wallet storage split ${a} --size ${options.size}`,
            };
        }
        if (options.epochs !== undefined) {
            return {
                ask: { kind: "splitEpochs", objectId: a, keepEpochs: Number(options.epochs) },
                command: `${BINARY_NAME} wallet storage split ${a} --epochs ${options.epochs}`,
            };
        }
        throw usage("split <resource id> --size <bytes> | --epochs <n>");
    }
    if (op === "merge") {
        if (a === undefined || b === undefined)
            throw usage("merge <resource id> <resource id>");
        return { ask: { kind: "merge", first: a, second: b }, command: `${BINARY_NAME} wallet storage merge ${a} ${b}` };
    }
    if (a === undefined || b === undefined)
        throw usage("transfer <resource id> <address>");
    return { ask: { kind: "transfer", objectId: a, to: b }, command: `${BINARY_NAME} wallet storage transfer ${a} ${b}` };
}
function usage(form) {
    return new NmtsError(`\`${BINARY_NAME} wallet storage ${form}\``, { exitCode: 2 });
}
/** "500MiB", "1GiB", "4096" — bytes, in binary units, the way the listing prints them. */
export function parseBytes(text) {
    const m = /^(\d+(?:\.\d+)?)\s*(B|KiB|MiB|GiB|TiB)?$/i.exec(text.trim());
    if (m === null || m[1] === undefined)
        throw new NmtsError("--size is a number of bytes, or one with KiB, MiB or GiB.", { exitCode: 2 });
    const unit = (m[2] ?? "B").toLowerCase();
    const scale = { b: 1, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4 }[unit] ?? 1;
    return Math.floor(Number(m[1]) * scale);
}
