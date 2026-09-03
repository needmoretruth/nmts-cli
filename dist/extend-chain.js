// The chain reads behind `nmts extend`: what a lease says, how far ahead the network sells, and
// what more epochs cost.
//
// ⛔ EVERYTHING HERE IS A READ. Nothing in this file builds a transaction, holds a key or moves an
//    asset — the signature lives next door in `extend-sign.ts`, alone, so that the file which can
//    spend is the smallest one in this tool. What is shared is the client builder below, because
//    the two must talk to the same chain: a quote read from one network and a payment made on
//    another is a payment for nothing.
//
// ⛔ SPLIT FROM THE COMMAND SO THE COMMAND CAN BE TESTED. `extend-plan.ts` decides what an
//    extension buys and `commands/extend.ts` decides what to say about it; both are driven by
//    `node --test` against fakes. A test that needed a live storage network could not run offline,
//    would answer differently every fortnight, and could never be asked to fail on demand.
//
// ⛔ AND NOTHING IS DEFAULTED TO ZERO. A lease that cannot be read, a shape the Move struct does
//    not have, a price the system object will not give — each throws with its reason. A cost of
//    zero on a screen that asks for money is the one wrong answer nobody would question.
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { walrus } from "@mysten/walrus";
import { NmtsError } from "./errors.js";
import { epochClock } from "./expiry.js";
import { isRecord } from "./guards.js";
import { epochStartedMs } from "./walrus-write.js";
import { suiRpcTransport } from "./sui-rpc.js";
/** How long one chain question gets. A read that stalls is a read that failed. */
export const EXTEND_READ_TIMEOUT_MS = 20_000;
/**
 * A Walrus-aware client for one network.
 *
 * ⛔ THE NETWORK NAME REACHES THE SDK AS WELL AS THE URL, exactly as it does for an upload. A
 *    mirror pointed at the wrong chain would otherwise be discovered as a refusal from the storage
 *    contract — after a transaction had been signed.
 */
export function walrusClient(network) {
    return build(network);
}
function build(network) {
    return new SuiJsonRpcClient({
        network: network === "mainnet" ? "mainnet" : "testnet",
        transport: suiRpcTransport(network),
    }).$extend(walrus({}));
}
/** A number off the wire, whether it arrived as a number or as one of Sui's 64-bit strings. */
function numberOf(value) {
    if (typeof value === "number")
        return Number.isFinite(value) ? value : null;
    if (typeof value !== "string" || value.trim() === "")
        return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
/**
 * One blob's lease, read from the Blob object itself.
 *
 * ⛔ NARROWED FROM `unknown`, NOT FROM THE SDK'S TYPE. `MoveStruct` is a three-way union whose
 *    members do not all carry an index signature, so reading a field off it means asserting — and
 *    an assertion compiles whether or not the check above it is right. What matters is the shape
 *    on the wire, and the predicate in `guards.ts` is what carries that narrowing.
 */
export async function readBlobLease(client, objectId) {
    const response = await client.getObject({
        id: objectId,
        options: { showContent: true },
    });
    const data = isRecord(response) ? response["data"] : undefined;
    const content = isRecord(data) ? data["content"] : undefined;
    if (!isRecord(content) || content["dataType"] !== "moveObject") {
        throw new NmtsError(`The storage object ${objectId} could not be read from the chain.`, {
            exitCode: 1,
            nextStep: "Nothing was signed and nothing was charged. The blob may already have been deleted, or " +
                "this tool may be pointed at the wrong network — `nmts env` says which one it is using.",
        });
    }
    const fields = content["fields"];
    const storage = isRecord(fields) ? fields["storage"] : undefined;
    const storageFields = isRecord(storage) ? storage["fields"] : undefined;
    const size = numberOf(isRecord(fields) ? fields["size"] : undefined);
    const endEpoch = numberOf(isRecord(storageFields) ? storageFields["end_epoch"] : undefined);
    if (size === null || endEpoch === null) {
        // ⛔ A shape change in the Move struct surfaces HERE, not as a wrong price downstream.
        throw new NmtsError(`The storage object ${objectId} is not shaped the way this version reads.`, {
            exitCode: 1,
            nextStep: "Nothing was signed and nothing was charged. Update this tool.",
        });
    }
    return { objectId, size, endEpoch };
}
/**
 * The reads one `nmts extend` run needs, bound to one network.
 *
 * ⚠ THE WINDOW IS `null` RATHER THAN A GUESS when the network cannot be read, exactly as it is for
 *   `nmts expiring`: the caller stops. An unread clock and a file in no danger look identical from
 *   outside and are the opposite of each other.
 */
export function extendReads(network) {
    const client = build(network);
    return {
        async readWindow() {
            try {
                const [system, staking] = await Promise.all([
                    client.walrus.systemState(),
                    client.walrus.stakingState(),
                ]);
                const clock = epochClock(Number(system.committee.epoch), Number(staking.epoch_duration), epochStartedMs(staking.epoch_state));
                if (clock === null)
                    return null;
                // How far ahead a lease may reach: the protocol's future-accounting ring length, which is
                // exactly what `storage_accounting::max_epochs_ahead` returns. Read, never assumed — it
                // is the difference between offering a length the network will sell and one it refuses
                // on-chain after the transaction is signed.
                const maxAhead = numberOf(system.future_accounting.length);
                if (maxAhead === null || maxAhead <= 0)
                    return null;
                return { clock, maxAhead };
            }
            catch {
                return null;
            }
        },
        readLeases(objectIds) {
            return Promise.all(objectIds.map((id) => readBlobLease(client, id)));
        },
        /**
         * What extending every one of these blobs by `epochs` costs, in FROST (WAL base units).
         *
         * ⭐ STORAGE ONLY. Extending pays for space over time; the write cost was paid once when the
         *    blob was registered and is not charged again. That is why extending is markedly cheaper
         *    than uploading the same bytes afresh, and why `totalCost` is the wrong field here.
         */
        async quote(leases, epochs) {
            if (epochs <= 0 || leases.length === 0)
                return 0n;
            const costs = await Promise.all(leases.map((lease) => client.walrus.storageCost(lease.size, epochs)));
            return costs.reduce((sum, cost) => sum + BigInt(cost.storageCost), 0n);
        },
    };
}
