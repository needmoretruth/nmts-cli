// `nmts wallet storage` — the storage resources the wallet holds: size × time, bought and not
// bound inside a file.
//
// ⛔ IT READS. What the storage network sells is size and time, not a file; deleting a file from the
//    network returns the remaining time to this wallet, and that is what is listed. Splitting,
//    fusing and spending a resource need a signature and are not here.
//
// ⛔ "NONE" AND "COULD NOT READ" ARE DIFFERENT SENTENCES — holding no resource is normal; failing to
//    read is a reason to look again. The reading, the ordering and that refusal are
//    `storage-control.ts`, which the SDK calls as well; this file is the terminal over it.
import { requireAccountCode } from "../code-access.js";
import { readCredentialsFile } from "../credentials.js";
import { resolveNetwork } from "../network.js";
import { BINARY_NAME } from "../product.js";
import { formatBytes, listStorage, } from "../storage-control.js";
import { resolveServer } from "../server.js";
import { walletAddress } from "../wallet.js";
export { formatBytes } from "../storage-control.js";
export async function walletStorage(options = {}) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    const resolved = await requireAccountCode();
    const address = await walletAddress(resolved.code);
    const stored = resolved.source === "file" || resolved.source === "file-locked" ? readCredentialsFile() : null;
    const server = resolveServer(options.server ?? stored?.server);
    const network = resolveNetwork(server, options.network ?? stored?.network);
    // ⚠ THE SENTENCE A PERSON READS IS THIS FILE'S, not the library's: `nmts env` is a command at a
    //   prompt and means nothing inside somebody else's program.
    const listed = await listStorage({ network, address }, options.readStorage, {
        cannotRead: `That is not the same as holding none. \`${BINARY_NAME} env\` says which network was asked.`,
    });
    const epoch = listed.currentEpoch;
    const items = listed.items;
    if (options.json) {
        say(JSON.stringify({
            address,
            network,
            currentEpoch: epoch,
            usableBytes: listed.usableBytes,
            resources: items.map((r) => ({
                objectId: r.objectId,
                sizeBytes: r.sizeBytes,
                startEpoch: r.startEpoch,
                endEpoch: r.endEpoch,
                status: r.status,
            })),
        }));
        return 0;
    }
    say(`Address  ${address}`);
    say(`Network  ${network}`);
    say(``);
    if (items.length === 0) {
        say(`  This wallet holds no free storage resource. Anything bound inside a file is not listed here.`);
    }
    else {
        if (listed.usableBytes !== null)
            say(`  ${formatBytes(listed.usableBytes)} usable now, in ${items.length} resource${items.length === 1 ? "" : "s"}.`);
        for (const r of items) {
            const status = r.status === null ? "" : `  ${statusWord(r.status)}`;
            say(`  ${formatBytes(r.sizeBytes).padStart(11)} · epoch ${r.startEpoch} to ${r.endEpoch}${status}`);
            say(`    ${r.objectId}`);
        }
    }
    say(``);
    say(`  What the storage network sells is size and time, not a file. Deleting a file from the`);
    say(`  network returns its remaining time to this wallet, and that is what is listed. Sizes are`);
    say(`  what a resource holds after the network's encoding, not file sizes. Nothing here signs.`);
    if (epoch === null)
        say(`  The current epoch could not be read, so no line says whether a resource can be used yet.`);
    return 0;
}
function statusWord(status) {
    return status === "usable" ? "usable now" : status === "notYet" ? "not started" : "ended";
}
