// `nmts wallet list` — every wallet this NMTS key has, what is in it, and which one pays.
//
// ⛔ IT READS. Nothing here signs, and nothing here writes the account's choice: `wallet use N`
//    does that. Running this repeatedly costs nothing but questions to a public node.
//
// ⛔ WHICH WALLETS EXIST IS NOT A LIST ANYBODY KEEPS. One key derives a wallet at every index
//    (NCF-3 §1.3), so "how many do I have" is answered by WALKING — ask about a number, then the
//    next, and stop after twenty unused ones in a row. That rule is the browser's own, copied
//    byte-for-byte (`shared/lib/wallet/discover.ts`), so the same key shows the same wallets in
//    both programs. ⚠ A wallet funded further out than the gap is not found by the walk; it is not
//    lost — `--wallet N` and `wallet use N` reach any number directly.
//
// ⛔ A BALANCE THAT COULD NOT BE READ IS PRINTED AS THAT, NEVER AS ZERO, and the run exits
//    non-zero — the same rule as `nmts wallet`, for the same reason: an empty wallet and an
//    unanswered question look identical on a screen, and one of them is a reason to stop.
import { requireAccountCode } from "../code-access.js";
import { readCredentialsFile } from "../credentials.js";
import { readFileList } from "../manifest.js";
import { resolveNetwork } from "../network.js";
import { BINARY_NAME } from "../product.js";
import { resolveServer } from "../server.js";
import { openSession } from "../session.js";
import { activeWalletOf, walletCountOf } from "../shared/lib/drive/manifest-settings.js";
import { discoverWallets } from "../shared/lib/wallet/discover.js";
import { coinAmount, readBalances, walCoinType, walletAddress, SUI_COIN_TYPE, } from "../wallet.js";
/** The table's column widths. A Sui address is 66 characters and gets two spaces after it. */
const NUMBER_W = 8;
const ADDRESS_W = 68;
const AMOUNT_W = 21;
export async function walletList(options = {}) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    const resolved = await requireAccountCode();
    const stored = resolved.source === "file" || resolved.source === "file-locked" ? readCredentialsFile() : null;
    const server = resolveServer(options.server ?? stored?.server);
    const network = resolveNetwork(server, options.network ?? stored?.network);
    const walType = walCoinType(network);
    const settings = await (options.readWalletSettings ?? (() => walletSettings(options)))();
    const open = options.openChain ??
        (async (net, addr) => (await import("../wallet-chain.js")).chainReader(net, addr));
    const history = options.hasHistory ??
        (async (net, addr) => (await import("../wallet-list-chain.js")).hasHistory(net, addr));
    // Every number the walk asked about, so nothing is derived or read twice.
    const seen = new Map();
    const scan = await discoverWallets(async (index) => {
        const address = await walletAddress(resolved.code, index);
        const balances = await readBalances(await open(network, address), walType);
        seen.set(index, { index, address, balances });
        const held = (b) => b.read && b.baseUnits > 0n;
        if (held(balances.sui) || held(balances.wal))
            return true;
        return history(network, address);
    }, { count: settings.count });
    // What is printed: the wallets this account has made, plus any the walk found beyond them. The
    // rest of the walk is the gap — empty wallets nobody has asked for.
    const rows = [...seen.values()]
        .filter((row) => row.index < settings.count || scan.used.includes(row.index))
        .sort((a, b) => a.index - b.index);
    const unread = rows.some((row) => !row.balances.sui.read || !row.balances.wal.read);
    if (options.json === true) {
        say(JSON.stringify({
            network,
            active: settings.active,
            scanned: scan.scanned,
            wallets: rows.map((row) => ({
                index: row.index,
                address: row.address,
                pays: row.index === settings.active,
                sui: asJson(row.balances.sui, SUI_COIN_TYPE),
                wal: asJson(row.balances.wal, walType),
            })),
        }));
        return unread ? 1 : 0;
    }
    // ⚠ The columns are laid out with the same widths the rows use, from the same constants — a
    //   header written out by hand drifts one space at a time until nothing lines up.
    say(`${"Wallet".padEnd(NUMBER_W)}${"Address".padEnd(ADDRESS_W)}${"SUI".padEnd(AMOUNT_W)}WAL`);
    for (const row of rows) {
        const pays = row.index === settings.active ? "  pays" : "";
        say(`${String(row.index).padEnd(NUMBER_W)}${row.address.padEnd(ADDRESS_W)}` +
            `${inWords(row.balances.sui).padEnd(AMOUNT_W)}${inWords(row.balances.wal)}${pays}`);
    }
    say(``);
    say(`  Every wallet above comes from this NMTS key, at the number in the first column. The one`);
    say(`  marked "pays" is the one storage is paid from — \`${BINARY_NAME} wallet use <number>\` moves it,`);
    say(`  on this account rather than on this machine. Numbers come from the key, so a wallet`);
    say(`  cannot be deleted.`);
    say(`  The list stops after twenty unused wallets in a row; a wallet further out than that is`);
    say(`  reached by its number.`);
    if (unread) {
        say(`  A balance that could not be read is printed as that and never as zero, and this command`);
        say(`  exits non-zero when it happens.`);
    }
    return unread ? 1 : 0;
}
/** The account's own numbers, read out of the sealed file list. */
async function walletSettings(options) {
    const session = await openSession({ server: options.server, network: options.network });
    const list = await readFileList(session.server, session.apiKey, session.code, session.accountId);
    const settings = list.manifest?.settings;
    return { active: activeWalletOf(settings), count: walletCountOf(settings) };
}
/** One balance, for a person. The same two sentences `nmts wallet` prints. */
function inWords(balance) {
    return balance.read ? coinAmount(balance.baseUnits) : `⛔ could not be read`;
}
/** One balance, for a program. `baseUnits` is a string: a balance outruns a JSON number. */
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
