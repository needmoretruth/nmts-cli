// The four server calls the credit-paid upload makes, narrowed to their shapes.
//
// ⛔ EACH ANSWER IS CHECKED, NOT CAST. These four replies decide whether money was spent and
//    whether a file exists; believing a field that is not there would turn a server mistake into a
//    silent one. What cannot be read is said so, in the caller's terms.
import { request } from "./api.js";
import { NmtsError } from "./errors.js";
function object(value, what) {
    if (typeof value !== "object" || value === null) {
        throw new NmtsError(`The server's answer about ${what} was not an object.`);
    }
    return value;
}
function reserveReply(value) {
    const v = object(value, "the reservation");
    const ledgerId = v["ledger_id"];
    const state = v["state"];
    if (typeof ledgerId !== "number" || typeof state !== "string") {
        throw new NmtsError("The server answered a reservation this version cannot read.", {
            nextStep: "Nothing was uploaded. Check whether an upload was charged before trying again.",
        });
    }
    const out = {
        ledger_id: ledgerId,
        state,
        credits_spent: typeof v["credits_spent"] === "number" ? v["credits_spent"] : 0,
    };
    if (typeof v["blob_object_id"] === "string")
        out.blob_object_id = v["blob_object_id"];
    if (typeof v["register_tx_digest"] === "string")
        out.register_tx_digest = v["register_tx_digest"];
    return out;
}
function statusReply(value) {
    const v = object(value, "the reservation");
    const ledgerId = v["ledger_id"];
    const state = v["state"];
    if (typeof ledgerId !== "number" || typeof state !== "string") {
        throw new NmtsError("The server answered a reservation this version cannot read.");
    }
    const out = { ledger_id: ledgerId, state };
    if (typeof v["blob_object_id"] === "string")
        out.blob_object_id = v["blob_object_id"];
    if (typeof v["register_tx_digest"] === "string")
        out.register_tx_digest = v["register_tx_digest"];
    return out;
}
function itemReply(value) {
    const v = object(value, "the committed file");
    const id = v["id"];
    if (typeof id !== "string" || id === "") {
        throw new NmtsError("The file was committed but the server did not say under which id.", {
            nextStep: "The bytes are stored and paid for. Running the same command again asks the server again " +
                "and does not spend anything more.",
        });
    }
    return { id };
}
/**
 * How long the certify and commit calls get.
 *
 * Longer than an ordinary request because both reach the chain, and because a timeout on either
 * leaves a paid upload unfinished — a slow answer is much better than a lost one.
 */
const CHAIN_TIMEOUT_MS = 120_000;
/** Bind the four calls to one server and one credential. */
export function createUploadApi(base, apiKey) {
    return {
        async reserve(body) {
            return reserveReply(await request(base, "/v1/sponsored/reserve", {
                method: "POST",
                token: apiKey,
                body,
                timeoutMs: CHAIN_TIMEOUT_MS,
            }));
        },
        async status(ledgerId) {
            return statusReply(await request(base, `/v1/sponsored/${ledgerId}`, { token: apiKey }));
        },
        async uploaded(ledgerId, certificate) {
            return request(base, `/v1/sponsored/${ledgerId}/uploaded`, {
                method: "POST",
                token: apiKey,
                body: { certificate },
                timeoutMs: CHAIN_TIMEOUT_MS,
            });
        },
        async createItem(body, idempotencyKey) {
            return itemReply(await request(base, "/v1/items", {
                method: "POST",
                token: apiKey,
                body,
                idempotencyKey,
                timeoutMs: CHAIN_TIMEOUT_MS,
            }));
        },
    };
}
