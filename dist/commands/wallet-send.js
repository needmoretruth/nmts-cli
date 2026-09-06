// `nmts wallet send <SUI|WAL> <amount|max> <address>` — move coins out of the wallet this NMTS
// key derives, to one address. ⛔ THE ONE COMMAND BESIDES `extend` THAT SIGNS.
//
// ⛔ THE ORDER IS THE SAFETY. ① the address and the amount are judged by the browser's own rules
//    (`shared/lib/wallet/send-rules.ts`, copied byte-for-byte) ② both balances are READ, and an
//    unread one stops the run — it is not zero ③ the exact transfer is dry-run for its fee ④ the
//    review is printed: the whole address, the amount, the fee, what is left ⑤ without `--yes`
//    that is the end — a transfer to a typed address cannot be undone, and this tool has no
//    prompt (`consent.ts`: a command, not a keystroke) ⑥ the wallet agreement is held against
//    the amount and the fee, scope `all` (`wallet-grant.ts`) ⑦ only then the signature.
//
// ⛔ NOT ON THE MCP SURFACE. A model can ask a person to run this; it cannot run it through a tool
//    call. Whether an agent may send money on its own is the person's `mode` and `--scope all`
//    decision at the command line, said in AGENTS.md — not a tool a model finds in a list.
import { requireAccountCode } from "../code-access.js";
import { readCredentialsFile } from "../credentials.js";
import { NmtsError } from "../errors.js";
import { resolveNetwork } from "../network.js";
import { BINARY_NAME } from "../product.js";
import { resolveServer } from "../server.js";
import { explorerTxUrl } from "../shared/lib/wallet/activity.js";
import { clampGasBudgetMist, maxSendableBaseUnits, parseTokenAmountToBaseUnits, validateSendForm, } from "../shared/lib/wallet/send-rules.js";
import { coinAmount, walCoinType, walletAddress } from "../wallet.js";
import { recordWalletSpend, requireWalletGrant } from "../wallet-grant.js";
const COIN_WORDS = {
    invalidAddress: "That is not a Sui address: it is 0x followed by 64 hexadecimal characters.",
    invalidAmount: "The amount must be a number above zero, with at most nine decimals.",
    insufficientBalance: "The wallet does not hold that much.",
    noGasForWal: "A WAL transfer pays its fee in SUI, and the wallet holds less SUI than the reserve kept for that.",
};
function coinOf(raw) {
    const up = (raw ?? "").toUpperCase();
    if (up === "SUI" || up === "WAL")
        return up;
    throw new NmtsError("Say which coin: SUI or WAL.", {
        exitCode: 2,
        nextStep: `\`${BINARY_NAME} wallet send <SUI|WAL> <amount|max> <address>\``,
    });
}
export async function walletSend(operands, options = {}) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    const [coinRaw, amountRaw, destinationRaw] = operands;
    const coin = coinOf(coinRaw);
    if (amountRaw === undefined || destinationRaw === undefined) {
        throw new NmtsError("Say how much, and to which address.", {
            exitCode: 2,
            nextStep: `\`${BINARY_NAME} wallet send ${coin} <amount|max> <address>\` — "max" sends everything that can be sent.`,
        });
    }
    const resolved = await requireAccountCode();
    const address = await walletAddress(resolved.code);
    const stored = resolved.source === "file" || resolved.source === "file-locked" ? readCredentialsFile() : null;
    const server = resolveServer(options.server ?? stored?.server);
    const network = resolveNetwork(server, options.network ?? stored?.network);
    const reads = await (options.readChain ?? (async (net) => (await import("../wallet-send-chain.js")).sendReads(net)))(network);
    // ② The balances — read, and refused as unread rather than treated as zero.
    const purse = await reads.readWallet(address);
    if (!purse.sui.read || !purse.wal.read) {
        const which = [!purse.sui.read ? `SUI: ${purse.sui.why}` : null, !purse.wal.read ? `WAL: ${purse.wal.why}` : null].filter((w) => w !== null);
        throw new NmtsError("A balance could not be read, so this tool cannot tell what can be sent.", {
            exitCode: 1,
            nextStep: `Nothing was signed. That is not an empty wallet — ${which.join("; ")}.`,
        });
    }
    const suiBalance = purse.sui.baseUnits;
    const walBalance = purse.wal.baseUnits;
    // ① The rules — the browser's, unchanged.
    const amountInput = amountRaw.toLowerCase() === "max"
        ? coinAmount(maxSendableBaseUnits({ coin, suiBalance, walBalance }))
        : amountRaw;
    const verdict = validateSendForm({ coin, amountInput, addressInput: destinationRaw, suiBalance, walBalance });
    if (!verdict.ok) {
        const exit = verdict.error === "invalidAddress" || verdict.error === "invalidAmount" ? 2 : 4;
        throw new NmtsError(COIN_WORDS[verdict.error], {
            exitCode: exit,
            nextStep: `Nothing was signed. The wallet holds ${coinAmount(suiBalance)} SUI and ${coinAmount(walBalance)} WAL; ` +
                `the most that can be sent is ${coinAmount(maxSendableBaseUnits({ coin, suiBalance, walBalance }))} ${coin} ` +
                `(SUI keeps a reserve back for fees).`,
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
    // ③ The fee of this exact transfer.
    const feeMist = await reads.estimateFee(shape, address);
    const suiAfter = suiBalance - (coin === "SUI" ? shape.amountBaseUnits : 0n) - (feeMist ?? 0n);
    const walAfter = walBalance - (coin === "WAL" ? shape.amountBaseUnits : 0n);
    const facts = {
        from: address,
        to: shape.destination,
        coin,
        amountBaseUnits: shape.amountBaseUnits.toString(),
        amount: coinAmount(shape.amountBaseUnits),
        feeMist: feeMist === null ? null : feeMist.toString(),
        feeSui: feeMist === null ? null : coinAmount(feeMist),
        feeCapMist: gasBudgetMist === undefined ? null : gasBudgetMist.toString(),
        network,
        suiAfter: coinAmount(suiAfter < 0n ? 0n : suiAfter),
        walAfter: coinAmount(walAfter < 0n ? 0n : walAfter),
    };
    // ④ The review, every time.
    if (!options.json) {
        say(`Sending ${facts.amount} ${coin}`);
        say(`  to    ${shape.destination}`);
        say(`  from  ${address}`);
        say(feeMist === null
            ? `  Chain fee (SUI): could not be measured just now; it is charged with the signature.`
            : `  Chain fee about ${facts.feeSui} SUI, measured by a dry run just now — the amount charged is fixed when it executes.`);
        if (gasBudgetMist !== undefined)
            say(`  Fee cap ${coinAmount(gasBudgetMist)} SUI — only up to this is used; the rest stays.`);
        say(`  Afterwards the wallet holds about ${facts.suiAfter} SUI and ${facts.walAfter} WAL.`);
        say(``);
        say(`  ⛔ A transfer cannot be undone by anybody, NMTS included. Check the address once more.`);
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
        throw new NmtsError("Nothing was signed: sending needs --yes.", {
            exitCode: 4,
            nextStep: `Read the review above, then: \`${BINARY_NAME} wallet send ${coin} ${amountRaw} ${shape.destination} --yes\``,
        });
    }
    // ⑥ The agreement — scope `all`, the amount and the fee held against its ceiling.
    const spend = {
        walFrost: coin === "WAL" ? shape.amountBaseUnits : 0n,
        suiMist: (coin === "SUI" ? shape.amountBaseUnits : 0n) + (feeMist ?? 0n),
    };
    requireWalletGrant("send", spend, new Date(options.now ?? Date.now()));
    // ⑦ The signature.
    const sign = options.sign ?? (await import("../wallet-sign.js")).signTransfer;
    const digest = await sign({ network, code: resolved.code, shape });
    recordWalletSpend(spend);
    if (options.json) {
        say(JSON.stringify({ ...facts, signed: true, digest, explorerUrl: explorerTxUrl(digest, network) }));
        return 0;
    }
    say(``);
    say(`  Sent. Transaction ${digest}`);
    say(`  ${explorerTxUrl(digest, network)}`);
    return 0;
}
