// What extending a file's storage would buy, worked out before anything is signed.
//
// ⛔ NO NETWORK, NO SDK, NO KEY. Everything here is arithmetic over numbers somebody else read, so
//    `node --test` can drive every branch — including the ones a live storage network only reaches
//    by being at its ceiling, or by having sold a lease that already ran out. The reads live in
//    `extend-chain.ts`, the signature in `wallet-sign.ts`, and neither can be reached from here.
//
// ⛔ THE CHAIN IS THE AUTHORITY ON WHEN A LEASE ENDS, not the server's `expiry_epoch`. That column
//    is client-reported and advisory — it is what `nmts expiring` ranks by, because ranking is all
//    it does — and a command that spends money reads the Blob object itself. The server's answer
//    is used for exactly one thing: knowing WHICH blobs to ask the chain about.
//
// ⛔ AND AN EXTENSION IS ADDED TO WHAT IS LEFT, never counted from today. Extending early loses
//    nothing, which is why this tool is allowed to offer it at all; the new end is
//    `endEpoch + epochs`, and that is the number every day count below is measured from.
import { NmtsError } from "./errors.js";
import { isRecord } from "./guards.js";
import { BINARY_NAME } from "./product.js";
/**
 * The longest extension the NMTS server will RECORD, in epochs.
 *
 * ⛔ IT IS THE SERVER'S NUMBER AND IT IS CHECKED HERE ANYWAY, before the money moves. `api`'s
 *    `MAX_EXTEND_EPOCHS` (routes/storage.rs) refuses to record anything longer — and the recording
 *    happens AFTER the signature, so a length the chain would happily sell and the server would
 *    refuse to write down produces the worst outcome this command has: storage that is really
 *    extended, paid for, and a drive that goes on saying the old date.
 *
 * ⚠ A SECOND COPY, deliberately. The alternative is discovering the limit from a 400 after
 *   spending. `check:cli-routes` holds the addresses level; nothing holds this number level, so it
 *   is named with its origin and the refusal it produces says what the server would have said.
 */
export const MAX_RECORDABLE_EPOCHS = 104;
/**
 * How long an extension is when nobody says.
 *
 * The same term one credit buys on the upload rail (`upload-price.ts`, `UPLOAD_EPOCHS`) and the
 * cheapest rung the browser's picker offers. ⚠ It is a number of EPOCHS, not of days: two epochs
 * is two days on testnet and twenty-eight on mainnet, so every surface that prints it prints the
 * days beside it, read from the network's own clock.
 */
export const DEFAULT_EXTEND_EPOCHS = 2;
/**
 * The preview, or a refusal.
 *
 * ⛔ A TARGET THIS CANNOT READ IS A REFUSAL, NOT A TARGET TO SKIP. Skipping one would produce a
 *    transaction that extends some of a file's blobs and leaves the others to expire — and the
 *    file is unreadable if any single one of them goes, so the money would buy nothing.
 */
export function asExtendPreview(value) {
    const unreadable = () => {
        throw new NmtsError("The server answered with an extension plan this version cannot read.", {
            nextStep: "Update this tool. Nothing was signed, and nothing was charged.",
        });
    };
    if (!isRecord(value))
        return unreadable();
    const raw = value["targets"];
    if (!Array.isArray(raw))
        return unreadable();
    const targets = [];
    for (const item of raw) {
        if (!isRecord(item))
            return unreadable();
        const objectId = item["sui_object_id"];
        const shared = item["shared_items"];
        if (typeof objectId !== "string" || objectId === "")
            return unreadable();
        if (typeof shared !== "number" || !Number.isFinite(shared))
            return unreadable();
        targets.push({ objectId, sharedItems: shared });
    }
    const treasury = value["treasury_parts"];
    const untracked = value["untracked_parts"];
    if (typeof treasury !== "number" || typeof untracked !== "number")
        return unreadable();
    return { targets, treasuryParts: treasury, untrackedParts: untracked };
}
/**
 * Refuse, before anything is signed, a blob the paying wallet does not hold.
 *
 * ⛔ WHAT A WALLET PAID FOR, ONLY THAT WALLET EXTENDS (`pay.ts` in the SDK says the same). The chain
 *    enforces it — but only after a signature was asked for, and for a remote signer (an operator's
 *    server signing for a customer) that is a request to sign a transaction that cannot run. Named
 *    here, each blob and who holds it, so the caller knows which wallet to pay from instead.
 */
export function refuseUnheld(leases, payer, file) {
    const mine = normaliseAddress(payer);
    const unheld = leases.flatMap((lease) => {
        const holder = lease.holder;
        if (holder === undefined || holder.kind === "shared")
            return [];
        if (holder.kind === "address" && normaliseAddress(holder.address) === mine)
            return [];
        return [`${lease.objectId} is held by ${holder.kind === "address" ? holder.address : holder.what}`];
    });
    if (unheld.length === 0)
        return;
    throw new NmtsError(`EXTEND_NOT_OWNED: the wallet ${payer} does not hold the storage of "${file}": ${unheld.join("; ")}.`, {
        exitCode: 4,
        nextStep: "Nothing was signed and nothing was charged. Only the wallet that holds a blob can extend it: " +
            "pay from that wallet, or leave this file to whoever holds it.",
    });
}
/** `0x` and 64 lower-case hex digits, whatever the spelling it arrived in. */
function normaliseAddress(address) {
    const hex = address.toLowerCase().replace(/^0x/, "");
    return `0x${hex.padStart(64, "0")}`;
}
/**
 * When the file actually runs out: the SOONEST end epoch across the blobs it rides on.
 *
 * ⛔ SOONEST, NOT FURTHEST. One expired blob is enough to make the file unreadable, so the file's
 *    deadline is the first of them. Null when there is no lease to read, which is a real state
 *    (every part on treasury-paid storage) and is never drawn as "now".
 */
export function soonestEnd(leases) {
    if (leases.length === 0)
        return null;
    return Math.min(...leases.map((l) => l.endEpoch));
}
/**
 * The largest number of epochs these leases can ALL be extended by.
 *
 * The ceiling is per-blob — a lease may not end more than `maxAhead` epochs past the current one —
 * so the blob that already reaches furthest into the future is the binding one. 0 is a real
 * answer ("already paid as far ahead as the network allows"), not a failure.
 */
export function headroom(leases, current, maxAhead) {
    if (leases.length === 0)
        return 0;
    const furthest = Math.max(...leases.map((l) => l.endEpoch));
    return Math.max(0, current + maxAhead - furthest);
}
/**
 * How many epochs to buy: what was asked for, or the default, checked against both ceilings.
 *
 * ⛔ IT REFUSES RATHER THAN CLAMPS. Quietly buying fewer epochs than somebody asked for spends
 *    their money on something they did not ask for, and quietly buying more spends more of it.
 *    Each refusal names the ceiling that produced it, because the two have different remedies:
 *    the network's is a wait, the server's is a shorter extension repeated later.
 */
export function chooseEpochs(asked, available) {
    if (available <= 0) {
        throw new NmtsError("This file's storage is already paid as far ahead as the network allows.", {
            exitCode: 4,
            nextStep: "Nothing was signed and nothing was charged. The storage network refuses a lease that " +
                "ends further ahead than its own ceiling. Extending again becomes possible as the " +
                "network's epoch moves forward.",
        });
    }
    const epochs = asked === undefined ? DEFAULT_EXTEND_EPOCHS : parseEpochs(asked);
    if (epochs > available) {
        throw new NmtsError(`The storage network will sell at most ${available} more epoch${available === 1 ? "" : "s"} on this file.`, {
            exitCode: 4,
            nextStep: `Nothing was signed and nothing was charged. A lease may not end further ahead than the ` +
                `network's own ceiling. Ask for ${available} or fewer: \`${BINARY_NAME} extend --epochs ${available}\`.`,
        });
    }
    if (epochs > MAX_RECORDABLE_EPOCHS) {
        throw new NmtsError(`This tool extends by at most ${MAX_RECORDABLE_EPOCHS} epochs at a time.`, {
            exitCode: 4,
            nextStep: `Nothing was signed and nothing was charged. The NMTS server refuses to record a longer ` +
                `one, so the storage would really be extended and the drive would go on showing the old ` +
                `date. Extend by ${MAX_RECORDABLE_EPOCHS} or fewer, more than once if you need to.`,
        });
    }
    return epochs;
}
/** A whole positive number of epochs, or the one refusal for anything else. */
function parseEpochs(asked) {
    const epochs = typeof asked === "number" ? asked : Number(asked.trim());
    if (!Number.isSafeInteger(epochs) || epochs <= 0) {
        throw new NmtsError(`An extension is a whole number of epochs: ${String(asked)}.`, {
            exitCode: 2,
            nextStep: `Nothing was signed and nothing was charged. \`--epochs 4\` buys four more of the storage ` +
                `network's epochs: one day each on testnet, fourteen on mainnet.`,
        });
    }
    return epochs;
}
/**
 * The network's clock and how far ahead it sells, or the refusal for a network that would not say.
 *
 * ⛔ Not "nothing needs extending". The two look identical from outside and mean opposite things.
 */
export async function readWindowOrRefuse(reads, network) {
    const window = await reads.readWindow();
    if (window !== null)
        return window;
    throw new NmtsError(`The ${network} storage network could not be read.`, {
        exitCode: 1,
        nextStep: `Nothing was signed and nothing was charged. Which epoch the network is in, and how far ` +
            `ahead it will sell, are facts only the chain has, and this will not spend against a ` +
            `guess. Try again, or name a different Sui node in NMTS_SUI_RPC.`,
    });
}
/** Why a file has nothing to extend, said as the two different things it can be. */
export function nothingToExtend(preview) {
    const parts = [];
    if (preview.treasuryParts > 0) {
        parts.push(`${preview.treasuryParts} part${preview.treasuryParts === 1 ? " is" : "s are"} on storage NMTS ` +
            `paid for, which this account cannot extend`);
    }
    if (preview.untrackedParts > 0) {
        parts.push(`${preview.untrackedParts} part${preview.untrackedParts === 1 ? " has" : "s have"} no ` +
            `recorded storage object, so there is nothing to name on the chain`);
    }
    const why = parts.length === 0 ? "The server lists no storage object for it." : `${parts.join(", and ")}.`;
    return `Nothing was signed and nothing was charged. ${why} Opening the account in a browser shows what it is stored on.`;
}
