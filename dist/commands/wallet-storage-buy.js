// `nmts wallet storage buy --size <n> [--epochs <n>]` — buying a storage resource with no file.
// ⛔ IT SIGNS AND SPENDS WAL. The order, the price, the dry run and the signature are
// `storage-control/buy.ts`, which the SDK calls as well; this file is the terminal over it: the
// words typed, the review read, `--yes`, and the wallet unlock held against what the review measured.
//
// ⛔ WHY (spec 2026-09-20 Deponejo · gap B2). A resource bought here is cut and handed on with the
//    three commands beside it (`split`, `merge`, `transfer`), in the same place and under the same
//    unlock scope — buying is a change to the wallet's storage like those, only one that costs WAL.
import { requireAccountCode } from "../code-access.js";
import { readCredentialsFile } from "../credentials.js";
import { NmtsError } from "../errors.js";
import { resolveNetwork } from "../network.js";
import { BINARY_NAME } from "../product.js";
import { resolveServer } from "../server.js";
import { buyStorage } from "../storage-control.js";
import { explorerTxUrl } from "../shared/lib/wallet/activity.js";
import { coinAmount, walletAddress } from "../wallet.js";
import { payingWalletIndex } from "../wallet-pay-index.js";
import { recordWalletSpend, requireWalletGrant } from "../wallet-grant.js";
import { parseBytes } from "./wallet-storage-ops.js";
import { formatBytes } from "./wallet-storage.js";
export async function walletStorageBuy(options = {}) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    if (options.size === undefined) {
        throw new NmtsError(`\`${BINARY_NAME} wallet storage buy --size <bytes> [--epochs <n>]\``, { exitCode: 2 });
    }
    const sizeBytes = parseBytes(options.size);
    const epochs = options.epochs === undefined ? undefined : Number(options.epochs);
    const resolved = await requireAccountCode();
    const wallet = await payingWalletIndex(options);
    const address = await walletAddress(resolved.code, wallet);
    const stored = resolved.source === "file" || resolved.source === "file-locked" ? readCredentialsFile() : null;
    const server = resolveServer(options.server ?? stored?.server);
    const network = resolveNetwork(server, options.network ?? stored?.network);
    const command = `${BINARY_NAME} wallet storage buy --size ${options.size}${options.epochs === undefined ? "" : ` --epochs ${options.epochs}`}`;
    // ⛔ WITHOUT `--yes` THE RUN STOPS AT THE REVIEW, exactly as `--dry-run` does.
    const stopAtReview = options.dryRun === true || options.yes !== true;
    const outcome = await buyStorage({ network, code: resolved.code, wallet, address }, { sizeBytes, epochs }, {
        reads: options.buyReads,
        sign: options.signStorage,
        dryRun: stopAtReview,
        onReview: (review) => {
            if (!options.json)
                describe(say, review, wallet);
        },
        // The unlock, held against the price and the fee. ⛔ Throwing here signs nothing.
        agree: (review) => {
            requireWalletGrant("reshape", spendOf(review), new Date(options.now ?? Date.now()));
        },
    });
    const { review } = outcome;
    const facts = {
        op: "buy",
        network,
        address,
        sizeBytes: review.sizeBytes,
        epochs: review.epochs,
        endEpoch: review.endEpoch,
        wal: coinAmount(review.priceFrost),
        feeSui: review.feeMist === null ? null : coinAmount(review.feeMist),
        shortfall: review.shortfall,
    };
    if (outcome.kind === "review") {
        if (options.json) {
            say(JSON.stringify({ ...facts, signed: false, dryRun: options.dryRun === true }));
            return options.dryRun === true ? 0 : 4;
        }
        say(``);
        if (options.dryRun === true) {
            say(`  Nothing was signed. Run the same command with --yes to buy it.`);
            return 0;
        }
        throw new NmtsError(`Nothing was signed: this needs --yes.`, {
            exitCode: 4,
            nextStep: `Read the review above, then: \`${command} --yes\``,
        });
    }
    recordWalletSpend(spendOf(review));
    const explorerUrl = explorerTxUrl(outcome.digest, network);
    if (options.json) {
        say(JSON.stringify({ ...facts, signed: true, digest: outcome.digest, id: outcome.objectId, explorerUrl }));
        return 0;
    }
    say(``);
    say(`  Bought. Transaction ${outcome.digest}`);
    if (outcome.objectId !== null)
        say(`  Resource ${outcome.objectId}`);
    say(`  ${explorerUrl}`);
    say(`  \`${BINARY_NAME} wallet storage\` lists it; \`put --pay wallet --storage <id>\` uploads into it.`);
    return 0;
}
/** What a purchase costs this wallet: the price in WAL and the fee the dry run measured. */
function spendOf(review) {
    return { walFrost: review.priceFrost, suiMist: review.feeMist ?? 0n };
}
/** The review a person reads, in the order somebody deciding needs it. */
function describe(say, review, wallet) {
    say(`Would buy a storage resource of ${formatBytes(review.sizeBytes)} for ${review.epochs} epoch${review.epochs === 1 ? "" : "s"}, epoch ${review.startEpoch} to ${review.endEpoch}.`);
    say(`  paid by  ${review.address} (wallet ${wallet}), which also receives it`);
    say(`  Storage ${coinAmount(review.priceFrost)} WAL. Writing a file into it later costs its own small WAL.`);
    say(review.feeMist === null
        ? `  Chain fee (SUI): could not be measured just now; it is charged with the signature.`
        : `  Chain fee about ${coinAmount(review.feeMist)} SUI, measured by a dry run just now.`);
    const wal = review.walFrost === null ? "WAL not read" : `${coinAmount(review.walFrost)} WAL`;
    const sui = review.suiMist === null ? "SUI not read" : `${coinAmount(review.suiMist)} SUI`;
    say(`  The wallet holds ${wal} and ${sui}.`);
    if (review.shortfall !== null)
        say(`  ⛔ ${review.shortfall}`);
    say(`  The size is what the network holds once a file is encoded, the unit the listing shows.`);
    say(`  Nobody, NMTS included, can reverse it.`);
}
