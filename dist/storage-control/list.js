// What a wallet holds in storage — the free resources, ordered and judged, without a screen.
//
// ⛔ EVERYTHING HERE IS A READ. What the storage network sells is size and time, not a file;
//    deleting a file from the network returns the remaining time to the wallet that bought it, and
//    that is what this lists. Splitting, joining and handing one over are next door in
//    `reshape.ts`, because each of them signs.
//
// ⛔ "NONE" AND "COULD NOT READ" ARE DIFFERENT ANSWERS, and this file is where that is kept: the
//    reader throws rather than answering an empty list, and `readOrRefuse` turns that into one
//    refusal with the chain's own cause in it. Flattening the two would draw a wallet full of
//    storage as a wallet with none, on the screen somebody decides what to buy from.
//
// ⛔ AND THE JUDGEMENT IS THE BROWSER'S, not a second copy of it: `shared/lib/storage-control/plan.ts`
//    is copied byte for byte from the browser and says what "usable" means and in what order these
//    are shown. Nothing here reaches for `node:`.
import { NmtsError } from "../errors.js";
import { statusOf, totalUsableBytes, usableFirst } from "../shared/lib/storage-control/plan.js";
/** Every free storage resource one address holds, in the order a person reads them. */
export async function listStorage(input, read = defaultRead, hints = {}) {
    const got = await readOrRefuse(() => read(input.network, input.address), hints);
    const epoch = got.currentEpoch;
    const ordered = epoch === null ? [...got.items] : usableFirst(got.items, epoch);
    return {
        address: input.address,
        network: input.network,
        currentEpoch: epoch,
        items: ordered.map((r) => ({ ...r, status: epoch === null ? null : statusOf(r, epoch) })),
        usableBytes: epoch === null ? null : totalUsableBytes(ordered, epoch),
    };
}
/**
 * The one refusal for a chain that did not answer.
 *
 * ⛔ IT IS NOT AN EMPTY LIST. Holding no resource is normal; failing to read is a reason to look
 *    again, and the chain's own words are carried so that whoever reads it knows which it was.
 */
export async function readOrRefuse(read, hints = {}) {
    try {
        return await read();
    }
    catch (error) {
        const said = hints.cannotRead ?? "That is not the same as holding none, and nothing was signed.";
        throw new NmtsError("The storage resources could not be read from the chain.", {
            exitCode: 1,
            nextStep: `${said} Cause: ${error instanceof Error ? error.message : String(error)}`,
        });
    }
}
/** The real read. Imported only when no seam was supplied — it loads the storage network's client. */
async function defaultRead(network, address) {
    return (await import("../wallet-storage-chain.js")).readWalletStorage(network, address);
}
/**
 * Bytes as a person reads them: binary units, two decimals, whole bytes below a KiB.
 *
 * ⚠ HERE RATHER THAN BESIDE THE SCREEN THAT PRINTS THEM, because the refusals in `reshape.ts` name
 *   a resource's size too, and a refusal that said `4294967296` about a resource a listing calls
 *   `4.00 GiB` would be two spellings of one number in front of the same person.
 */
export function formatBytes(bytes) {
    const units = ["KiB", "MiB", "GiB", "TiB"];
    let value = bytes;
    let unit = "B";
    for (const next of units) {
        if (value < 1024)
            break;
        value /= 1024;
        unit = next;
    }
    return unit === "B" ? `${bytes} B` : `${value.toFixed(2)} ${unit}`;
}
