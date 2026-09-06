// `nmts wallet donate <SUI|WAL> <amount>` — a voluntary gift to the developer, from the wallet this
// NMTS key derives. A HIGH act (2026-09-06): the `donate` unlock opens it, and every run
// still needs `--yes` — the tier gate in main.ts holds the door; this file holds the sending.
//
// ⛔ THE WALLET AGREEMENT DOES NOT REACH A GIFT. A gift is neither covered by that agreement nor
//    counted against its ceiling: the agreement is what lets a PROGRAM sign for storage; a gift is
//    approved on the run that sends it, under the `donate` unlock the person gave.
//
// ⛔ WHERE THE ADDRESS COMES FROM. The server publishes it at `GET /api/donation`, the same value the
//    wallet screen's card is built from. It is read on every run and never written down here — an
//    address baked into this tool would go on receiving gifts after the owner changed it.
//
// ⛔ WHAT IS SAID BEFORE SIGNING, every time: the four facts (voluntary · nothing in return ·
//    non-refundable · cannot be undone) and the one the terms promise — no record is kept, the
//    transaction id is the only proof (terms 11.5).
import { request } from "../api.js";
import { requireAccountCode } from "../code-access.js";
import { readCredentialsFile } from "../credentials.js";
import { NmtsError } from "../errors.js";
import { isRecord } from "../guards.js";
import { resolveNetwork } from "../network.js";
import { BINARY_NAME } from "../product.js";
import { resolveServer } from "../server.js";
import { THANKS_EN, THANKS_KO } from "../standing-tip.js";
import { explorerTxUrl } from "../shared/lib/wallet/activity.js";
import { clampGasBudgetMist, isValidSuiAddress, parseTokenAmountToBaseUnits, validateSendForm, } from "../shared/lib/wallet/send-rules.js";
import { coinAmount, walCoinType, walletAddress } from "../wallet.js";
/** The four facts and the promise, as the screens say them, in the order a person reads them. */
export const GIFT_NOTICES = [
    "This is a voluntary gift. Nothing is provided in return, it is non-refundable, and it cannot be undone once sent.",
    "We keep no record of who sent what. If you ever need to ask about this gift, keep the transaction id shown after sending — it is the only proof.",
];
export function asDonationConfig(value) {
    if (!isRecord(value))
        throw new NmtsError("The server's donation answer is not the shape this version reads.", { exitCode: 1 });
    const devAddress = value["devAddress"];
    return {
        devAddress: typeof devAddress === "string" ? devAddress : "",
        sendEnabled: value["sendEnabled"] === true,
        walEnabled: value["walEnabled"] === true,
    };
}
function coinOf(raw) {
    const up = (raw ?? "").toUpperCase();
    if (up === "SUI" || up === "WAL")
        return up;
    throw new NmtsError("Say which coin: SUI or WAL.", {
        exitCode: 2,
        nextStep: `\`${BINARY_NAME} wallet donate <SUI|WAL> <amount> --yes\``,
    });
}
export async function walletDonate(operands, options = {}) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    const [coinRaw, amountRaw] = operands;
    const coin = coinOf(coinRaw);
    if (amountRaw === undefined) {
        throw new NmtsError("Say how much.", { exitCode: 2, nextStep: `\`${BINARY_NAME} wallet donate ${coin} <amount> --yes\`` });
    }
    const resolved = await requireAccountCode();
    const address = await walletAddress(resolved.code);
    const stored = resolved.source === "file" || resolved.source === "file-locked" ? readCredentialsFile() : null;
    const server = resolveServer(options.server ?? stored?.server);
    const network = resolveNetwork(server, options.network ?? stored?.network);
    const config = await (options.readDonation ?? (async (base) => asDonationConfig(await request(base, "/api/donation"))))(server);
    if (!config.sendEnabled || !isValidSuiAddress(config.devAddress)) {
        throw new NmtsError("Gifts are not open right now.", {
            exitCode: 4,
            nextStep: "Nothing was signed. The donation card in the browser says the same when it is off.",
        });
    }
    if (coin === "WAL" && !config.walEnabled) {
        throw new NmtsError("Gifts in WAL are not open right now; SUI is.", { exitCode: 4, nextStep: "Nothing was signed." });
    }
    const reads = await (options.readChain ?? (async (net) => (await import("../wallet-send-chain.js")).sendReads(net)))(network);
    const purse = await reads.readWallet(address);
    if (!purse.sui.read || !purse.wal.read) {
        throw new NmtsError("A balance could not be read, so this tool cannot tell whether the wallet can give this.", {
            exitCode: 1,
            nextStep: "Nothing was signed. That is not an empty wallet.",
        });
    }
    const verdict = validateSendForm({
        coin,
        amountInput: amountRaw,
        addressInput: config.devAddress,
        suiBalance: purse.sui.baseUnits,
        walBalance: purse.wal.baseUnits,
    });
    if (!verdict.ok) {
        const why = verdict.error === "invalidAmount"
            ? "The amount must be a number above zero, with at most nine decimals."
            : verdict.error === "noGasForWal"
                ? "A WAL gift pays its fee in SUI, and the wallet holds less SUI than the reserve kept for that."
                : verdict.error === "invalidAddress"
                    ? "The published address is not a Sui address; nothing was sent."
                    : "The wallet does not hold that much.";
        throw new NmtsError(why, {
            exitCode: verdict.error === "invalidAmount" ? 2 : 4,
            nextStep: `Nothing was signed. The wallet holds ${coinAmount(purse.sui.baseUnits)} SUI and ${coinAmount(purse.wal.baseUnits)} WAL.`,
        });
    }
    const gasBudgetMist = options.feeCap === undefined ? undefined : clampGasBudgetMist(parseTokenAmountToBaseUnits(options.feeCap) ?? 0n);
    const shape = {
        coin,
        amountBaseUnits: verdict.amountBaseUnits,
        destination: verdict.address,
        walType: walCoinType(network),
        gasBudgetMist,
    };
    const feeMist = await reads.estimateFee(shape, address);
    const facts = {
        to: shape.destination,
        coin,
        amountBaseUnits: shape.amountBaseUnits.toString(),
        amount: coinAmount(shape.amountBaseUnits),
        feeMist: feeMist === null ? null : feeMist.toString(),
        feeSui: feeMist === null ? null : coinAmount(feeMist),
        network,
    };
    if (!options.json) {
        say(`Gift of ${facts.amount} ${coin} to the developer`);
        say(`  ${shape.destination}`);
        say(feeMist === null
            ? `  Chain fee (SUI): could not be measured just now; it is charged with the signature.`
            : `  Chain fee about ${facts.feeSui} SUI, measured by a dry run just now.`);
        say(``);
        for (const line of GIFT_NOTICES)
            say(`  ${line}`);
    }
    if (options.dryRun === true || options.yes !== true) {
        if (options.json) {
            say(JSON.stringify({ ...facts, signed: false, dryRun: options.dryRun === true }));
            return options.dryRun === true ? 0 : 4;
        }
        say(``);
        if (options.dryRun === true) {
            say(`  Nothing was signed. Run the same command with --yes to send it.`);
            return 0;
        }
        throw new NmtsError("Nothing was signed: a gift needs --yes, every time.", {
            exitCode: 4,
            nextStep: `Read the lines above, then: \`${BINARY_NAME} wallet donate ${coin} ${amountRaw} --yes\``,
        });
    }
    const sign = options.sign ?? (await import("../wallet-sign.js")).signTransfer;
    const digest = await sign({ network, code: resolved.code, shape });
    if (options.json) {
        say(JSON.stringify({ ...facts, signed: true, digest, explorerUrl: explorerTxUrl(digest, network) }));
        return 0;
    }
    say(``);
    say(`  Thank you — your gift was sent. Transaction ${digest}`);
    say(`  ${explorerTxUrl(digest, network)}`);
    say(`  Keep that id: no record of this gift exists anywhere else.`);
    // ⛔ THE OWNER'S OWN THANKS, IN BOTH LANGUAGES, after every gift whatever its size — the same two
    //    sentences the browser shows and the standing tip prints, held in one place so they cannot
    //    drift apart.
    say(``);
    say(`  ${THANKS_EN}`);
    say(`  ${THANKS_KO}`);
    say(`  To be listed by name on nmts.me/hall: ${BINARY_NAME} wallet hall --name <name>`);
    return 0;
}
