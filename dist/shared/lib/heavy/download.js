// Read one NMTS Heavy part back from the storage companies that keep its copies.
//
// ⚠ THIS FILE IS PUBLISHED. It is copied byte-for-byte into the `nmts` command-line package.
//   Keep the comments self-contained English, with no pointer only we can follow.
//
// Each copy names a public address, `https://<company>/piece/<PieceCID>` — no credentials, open CORS,
// byte ranges allowed. The copies are asked in order; the first that answers with the bytes is used,
// and any failure moves on to the next one.
//
// ⛔ ONLY ALLOWLISTED COMPANIES, ONLY HTTPS. An address comes from our server, and a browser page may
//    only talk to hosts its security policy names — so a copy at a company outside the allowlist for
//    this chain is skipped with a reason rather than asked (the request would be blocked anyway, as a
//    bare "Failed to fetch"). A program with no such policy may pass `allowUnlisted` to ask any https
//    company — somebody paying from their own wallet may have picked one the list does not name.
//
// ⛔ THE BYTES ARE NOT CHECKED HERE. They are an end-to-end sealed stream, and opening it is the check:
//    a wrong or altered byte fails authentication when it is decrypted. Recomputing the PieceCID would
//    cost a full hash of the part and tell us nothing the decryption does not.
import { providerForHost } from "../filecoin/providers.js";
/**
 * Every copy failed. `notFound` is true only when every company actually asked answered 404 — one
 * that was down or erred may still hold the piece, which is the same rule the Walrus reads keep.
 */
export class HeavyDownloadError extends Error {
    pieceCid;
    attempts;
    notFound;
    constructor(pieceCid, attempts) {
        const asked = attempts.filter((a) => a.reason !== "not_https" && a.reason !== "host_not_allowed");
        const notFound = asked.length > 0 && asked.every((a) => a.reason === "not_found");
        super(attempts.length === 0
            ? `Piece ${pieceCid} has no recorded copies to read.`
            : `No copy of piece ${pieceCid} could be read: ` +
                attempts.map((a) => `${a.providerId} ${a.reason}${a.status ? ` ${a.status}` : ""}`).join(" | "));
        // Two names, so a reader that sorts failures by name can tell "gone" from "unreachable".
        this.name = notFound ? "HeavyPieceNotFoundError" : "HeavyDownloadError";
        this.pieceCid = pieceCid;
        this.attempts = attempts;
        this.notFound = notFound;
    }
}
/** Build the HTTP `Range` value from an exclusive-end range, or `null` for the whole part. */
function rangeHeader(range) {
    if (range === undefined)
        return null;
    const { start, end } = range;
    if (!Number.isSafeInteger(start) || start < 0)
        throw new RangeError(`Invalid range start ${start}.`);
    if (end === undefined)
        return `bytes=${start}-`;
    if (!Number.isSafeInteger(end) || end <= start)
        throw new RangeError(`Invalid range end ${end}.`);
    return `bytes=${start}-${end - 1}`;
}
/** Why this copy may not be asked at all, or `null` when it may. */
function refusalFor(copy, chain, allowUnlisted) {
    let url;
    try {
        url = new URL(copy.retrieval_url);
    }
    catch {
        // An address that does not parse is refused the same way as one that is not https.
        return "not_https";
    }
    if (url.protocol !== "https:")
        return "not_https";
    if (!allowUnlisted && providerForHost(chain, url.hostname) === null)
        return "host_not_allowed";
    return null;
}
/**
 * Open a streaming read of one Heavy part from the first copy that serves it.
 *
 * Resolves with the response (status 200, or 206 for a range) whose body is the sealed part;
 * rejects with `HeavyDownloadError` when no copy serves it, or with the AbortError of `signal`.
 * A company that ignores `Range` and answers 200 with the whole part is accepted — the caller reads
 * only what it needs and cancels the rest.
 */
export async function fetchHeavyPart(input) {
    const fetchImpl = input.fetchImpl ?? ((url, init) => fetch(url, init));
    const range = rangeHeader(input.range);
    const attempts = [];
    for (const copy of input.copies) {
        if (input.signal?.aborted)
            throw new DOMException("The operation was aborted.", "AbortError");
        const refused = refusalFor(copy, input.chain, input.allowUnlisted === true);
        if (refused !== null) {
            attempts.push({ providerId: copy.provider_id, reason: refused });
            continue;
        }
        let res;
        try {
            res = await fetchImpl(copy.retrieval_url, {
                method: "GET",
                ...(range === null ? {} : { headers: { Range: range } }),
                ...(input.signal === undefined ? {} : { signal: input.signal }),
            });
        }
        catch (err) {
            if (input.signal?.aborted)
                throw err;
            attempts.push({ providerId: copy.provider_id, reason: "network_error" });
            continue;
        }
        if ((res.status === 200 || res.status === 206) && res.body !== null)
            return res;
        attempts.push({
            providerId: copy.provider_id,
            reason: res.status === 404 ? "not_found" : "http_error",
            status: res.status,
        });
        // This answer is not going to be read; free the connection before asking the next company.
        await res.body?.cancel().catch(() => undefined); // a failed cancel changes nothing we do next
    }
    throw new HeavyDownloadError(input.pieceCid, attempts);
}
