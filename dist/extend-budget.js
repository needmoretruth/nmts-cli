// What the wallet holds against what this extension costs — worked out BEFORE the agreement is
// asked for and before anything is signed.
//
// ⛔ WHY IT IS BEFORE THE AGREEMENT. The agreement ladder exists so that a program cannot sign
//    with somebody's wallet until a person has said so on this machine. Learning that the wallet
//    is short is a read, and a person should not have to grant the one key that matters in order
//    to be told there is nothing to spend. So a shortfall is refused first, with the two numbers,
//    and the agreement is asked for only when the purchase can go through.
//
// ⛔ AN UNREAD BALANCE IS NOT A SHORTFALL. `wallet.ts` prints an unreadable balance as that and
//    never as zero, and this file keeps the rule where it costs the most: a zero here would refuse
//    a purchase the wallet can afford. An unread balance is SAID, and the run goes on — the chain
//    refuses the signature itself if the money is not there, exactly as it did before this file.
//
// ⛔ THE FEE IS MEASURED, NOT ASSUMED. It is a dry run of the exact transaction that would be
//    signed (`extend-chain.ts`), and when the chain cannot measure it the answer is `null` and the
//    words say so. A plausible number in its place would be indistinguishable from a measured one.
import { BINARY_NAME } from "./product.js";
import { coinAmount } from "./wallet.js";
function held(coin) {
    return coin.read ? coin.baseUnits : null;
}
/** Read the wallet and measure the fee, then say whether the known numbers cover the purchase. */
export async function readBudget(reads, input) {
    const { address, objectIds, epochs, priceFrost } = input;
    const [purse, feeMist] = await Promise.all([
        reads.readWallet(address),
        reads.estimateGas({ sender: address, objectIds, epochs }),
    ]);
    const walFrost = held(purse.wal);
    const suiMist = held(purse.sui);
    const unread = [];
    if (!purse.wal.read)
        unread.push(`WAL: ${purse.wal.why}`);
    if (!purse.sui.read)
        unread.push(`SUI: ${purse.sui.why}`);
    let shortfall = null;
    if (walFrost !== null && walFrost < priceFrost) {
        shortfall =
            `The wallet holds ${coinAmount(walFrost)} WAL and this extension costs ` +
                `${coinAmount(priceFrost)} WAL.`;
    }
    else if (suiMist !== null && feeMist !== null && suiMist < feeMist) {
        shortfall =
            `The wallet holds ${coinAmount(suiMist)} SUI and the chain fee for this extension is ` +
                `about ${coinAmount(feeMist)} SUI.`;
    }
    return { address, priceFrost, walFrost, suiMist, feeMist, unread, shortfall };
}
/** The budget as the machine-readable answer carries it. ⚠ Base units are strings — see `Facts`. */
export function budgetFacts(b) {
    return {
        wallet: b.address,
        walletWal: b.walFrost === null ? null : coinAmount(b.walFrost),
        walletSui: b.suiMist === null ? null : coinAmount(b.suiMist),
        feeMist: b.feeMist === null ? null : b.feeMist.toString(),
        feeSui: b.feeMist === null ? null : coinAmount(b.feeMist),
    };
}
/** The next step when the wallet is short: where to send what, said once. */
export function shortfallNextStep(b) {
    const coin = b.walFrost !== null && b.walFrost < b.priceFrost ? "WAL" : "SUI";
    return (`Nothing was signed and nothing was charged. Send ${coin} to ${b.address} — ` +
        `\`${BINARY_NAME} wallet\` shows the address and both balances — and run this again.`);
}
/** The fee and the wallet, for a person, after the price. */
export function describeBudget(say, b) {
    if (b.feeMist === null) {
        say(`  The chain fee (SUI) could not be measured just now; it is charged with the signature.`);
    }
    else {
        say(`  Chain fee about ${coinAmount(b.feeMist)} SUI, measured by a dry run just now — the amount ` +
            `charged is fixed when the transaction executes.`);
    }
    const wal = b.walFrost === null ? "WAL not read" : `${coinAmount(b.walFrost)} WAL`;
    const sui = b.suiMist === null ? "SUI not read" : `${coinAmount(b.suiMist)} SUI`;
    say(`  Wallet ${b.address} holds ${wal} and ${sui}.`);
    for (const why of b.unread) {
        say(`  A balance could not be read — ${why}. That is not zero: the chain decides at signing.`);
    }
}
