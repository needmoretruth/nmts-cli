// The four doors an opener travels through, and nothing else.
//
// ⛔ THREE OF THEM ASK FOR THE ACCOUNT CODE'S OWN PROOF BESIDE THE CREDENTIAL, the grade erasing
//    files carries. Adding an opener makes a standing way into the account that outlives whatever
//    session made it; removing one takes a way in away; and the LIST is the inventory of every
//    road into somebody's files. All three are acts of whoever holds the key, so all three ask for
//    the key. ⚠ The proof is built by the caller and arrives as a value, exactly as `drive-erase.ts`
//    takes it: whether this run may make one is a policy question with two different answers.
//
// ⛔ AND THE FOURTH TAKES NOTHING AT ALL, WHICH IS THE POINT. Somebody signing in with a wallet has
//    no credential yet and does not know which account they are about to open — that is what the
//    slot tells them. So the fetch carries no header, and a locator nobody has answers exactly as
//    one belonging to somebody else does: `null` here, one 404 there.
//
// ⚠ NOTHING HERE REACHES FOR `node:`, and nothing here prints. The SDK's browser entry bundles what
//   this exports, and every sentence a person reads belongs to whoever called.
import { request, ServerError } from "../api.js";
import { toBase64Url } from "../bytes.js";
/** Slot kind: a Sui wallet's signature over the opener message. */
export const KIND_WALLET = 1;
/** Slot kind: a WebAuthn passkey's PRF output. Reserved; nothing in this package writes one. */
export const KIND_PASSKEY = 2;
/** Every opener on this account. */
export async function listOpeners(access) {
    const answer = await request(access.server, "/v1/openers", {
        token: access.apiKey,
        accountProof: access.accountProof,
    });
    const rows = at(answer, "openers");
    const cap = at(answer, "cap");
    return {
        openers: (Array.isArray(rows) ? rows : []).flatMap((row) => (row === null ? [] : [oneOpener(row)])),
        cap: typeof cap === "number" ? cap : 0,
    };
}
/**
 * Store or replace the slot filed under this locator.
 *
 * ⚠ REPLACING IS NOT AN ACCIDENT. The same wallet re-wrapping its own slot — a new message version,
 *   a new derivation — writes the same locator and must overwrite rather than be refused as one
 *   opener too many.
 */
export async function putOpener(access, locator, kind, slot) {
    await request(access.server, `/v1/openers/${encodeURIComponent(locator)}`, {
        method: "PUT",
        body: { kind, slot: toBase64Url(slot) },
        token: access.apiKey,
        accountProof: access.accountProof,
    });
}
/**
 * Take one road into the account away.
 *
 * ⛔ IT IS "FROM NOW ON", NOT "AS IF IT NEVER KNEW". A wallet that has opened this account once has
 *    held the NMTS key; removing its slot stops it opening the account again and cannot unknow
 *    what it learned. The sentence saying so belongs to whoever asked — it is not the server's and
 *    it is not this file's.
 */
export async function removeOpener(access, locator) {
    await request(access.server, `/v1/openers/${encodeURIComponent(locator)}`, {
        method: "DELETE",
        token: access.apiKey,
        accountProof: access.accountProof,
    });
}
/**
 * The sealed bytes filed under this locator, or `null` when the server has none.
 *
 * ⛔ NO CREDENTIAL AND NO ACCOUNT ID GOES WITH IT, and none comes back: the answer is the slot and
 *    nothing else. `null` covers every reason the server has to refuse it — unknown, malformed, or
 *    an account since erased — because telling them apart is a way to learn which names exist.
 */
export async function fetchSlot(server, locator) {
    try {
        return await request(server, `/v1/opener/${encodeURIComponent(locator)}`, { as: "bytes" });
    }
    catch (error) {
        if (error instanceof ServerError && error.status === 404)
            return null;
        throw error;
    }
}
/** One listed row, read defensively: it arrived over the network. */
function oneOpener(row) {
    const kind = at(row, "kind");
    const locator = at(row, "locator");
    const created = at(row, "created_at");
    return {
        locator: typeof locator === "string" ? locator : "",
        kind: kind === KIND_WALLET ? "wallet" : kind === KIND_PASSKEY ? "passkey" : "other",
        createdAt: typeof created === "string" ? created : "",
    };
}
/** One field of something the server sent, without asserting its shape. */
function at(value, name) {
    return typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined;
}
