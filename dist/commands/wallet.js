// `nmts wallet` — which wallet this account code opens, and what the chain says is in it.
//
// ⛔ IT READS. Nothing in this command signs, sends, swaps or spends, and there is no option that
//    makes it. That is why it asks for no agreement: the agreement ladder stops a program from
//    signing with a wallet on somebody's behalf, and asking for it here — where nothing can move —
//    would teach a person to grant the one key that matters in order to look at a number.
//
// ⛔ THE ADDRESS AND THE BALANCES ARE DIFFERENT KINDS OF FACT, so they fail differently. The
//    address is computed on this machine from the account code and cannot fail for any reason
//    outside it; the balances come from a public node that can be slow, wrong or down. `nmts
//    wallet address` is the half that never needs a network, and it exists because "what is my
//    address" is the question somebody asks when the network is the thing that is broken.
//
// ⛔ AND A BALANCE THAT COULD NOT BE READ IS PRINTED AS THAT, NEVER AS ZERO — in words for a
//    person, as `"read": false` for a program, and as a non-zero exit code for whatever is
//    checking only that. An empty wallet and an unanswered question look identical on a screen,
//    and one of them is a reason to stop.
import { requireAccountCode } from "../code-access.js";
import { readCredentialsFile } from "../credentials.js";
import { NmtsError } from "../errors.js";
import { resolveNetwork } from "../network.js";
import { BINARY_NAME } from "../product.js";
import { resolveServer } from "../server.js";
import { coinAmount, readBalances, walCoinType, walletAddress, SUI_COIN_TYPE, } from "../wallet.js";
/** What the operand may say. Anything else is a command line to correct, not a guess to act on. */
const MODES = ["address", "balance"];
function modeOf(what) {
    if (what === undefined || what === "balance")
        return "balance";
    if (what === "address")
        return "address";
    throw new NmtsError(`\`${BINARY_NAME} wallet ${what}\` is not something this command does.`, {
        exitCode: 2,
        nextStep: `\`${BINARY_NAME} wallet\` shows the address and the balances, and ` +
            `\`${BINARY_NAME} wallet address\` shows the address alone, without touching a network.`,
    });
}
export async function wallet(what, options = {}) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    const mode = modeOf(what);
    const resolved = await requireAccountCode();
    const address = await walletAddress(resolved.code);
    if (mode === "address") {
        if (options.json) {
            // ⛔ NO `network` FIELD. There is no network in this answer — an account has one wallet and
            //    it is called the same thing on every chain — and a field naming one would invite a
            //    reader to believe this address was looked up somewhere.
            say(JSON.stringify({ address }));
            return 0;
        }
        say(`Address  ${address}`);
        say(``);
        say(`  Derived on this machine from the account code. Nothing was asked of the NMTS server or`);
        say(`  of any chain, so this says what the wallet is called and nothing about what is in it.`);
        say(`  The browser app derives the same address from the same code.`);
        return 0;
    }
    // ⛔ THE SERVER IS RESOLVED BUT NEVER CALLED. It is here for one thing only: the live server
    //    implies mainnet, and which chain to ask is a question this tool refuses to guess at
    //    (`network.ts`). Reading the stored file matches `whoami` — somebody who signed in against
    //    a development stack on testnet must not be shown a mainnet answer.
    const stored = resolved.source === "file" || resolved.source === "file-locked" ? readCredentialsFile() : null;
    const server = resolveServer(options.server ?? stored?.server);
    const network = resolveNetwork(server, options.network ?? stored?.network);
    const open = options.openChain ??
        (async (net, addr) => (await import("../wallet-chain.js")).chainReader(net, addr));
    const walType = walCoinType(network);
    const balances = await readBalances(await open(network, address), walType);
    if (options.json) {
        say(JSON.stringify({
            address,
            network,
            sui: asJson(balances.sui, SUI_COIN_TYPE),
            wal: asJson(balances.wal, walType),
        }));
        return exitCodeFor(balances);
    }
    say(`Address  ${address}`);
    say(`Network  ${network}`);
    say(`SUI      ${inWords(balances.sui)}`);
    say(`WAL      ${inWords(balances.wal)}`);
    say(``);
    say(`  The address is derived on this machine from the account code; the balances were read`);
    say(`  from the ${network} chain just now, and they move without this tool.`);
    if (!balances.sui.read || !balances.wal.read) {
        say(`  A balance that could not be read is printed as that and never as zero, and this command`);
        say(`  exits non-zero when it happens — so nothing driving it reads a missing number as an`);
        say(`  empty wallet.`);
    }
    say(`  Nothing here signs or spends. \`${BINARY_NAME} extend\` is the one command that signs, and it`);
    say(`  asks for a separate agreement before it does.`);
    return exitCodeFor(balances);
}
/**
 * ⛔ AN UNREAD BALANCE IS A FAILURE, even beside one that answered. A program that checks the exit
 *    code and nothing else is the ordinary case, and telling it "fine" while half the answer is
 *    missing is the same mistake as printing the missing half as zero.
 */
function exitCodeFor(balances) {
    return balances.sui.read && balances.wal.read ? 0 : 1;
}
/** One balance, for a person. */
function inWords(balance) {
    return balance.read ? coinAmount(balance.baseUnits) : `⛔ could not be read — ${balance.why}`;
}
/**
 * One balance, for a program.
 *
 * ⚠ `baseUnits` IS A STRING. A balance can hold more digits than a JSON number keeps, and a
 *   silently rounded total is worse than no total. `amount` is the same value written as a person
 *   reads it, exactly, so a caller never has to divide.
 */
function asJson(balance, coinType) {
    if (!balance.read)
        return { coinType, read: false, error: balance.why };
    return {
        coinType,
        read: true,
        baseUnits: balance.baseUnits.toString(),
        amount: coinAmount(balance.baseUnits),
    };
}
