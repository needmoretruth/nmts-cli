// Upload one sealed part to a Filecoin storage company, straight from this device.
//
// ⚠ THIS FILE IS PUBLISHED. It is copied byte-for-byte into the `nmts` command-line package.
//   Keep the comments self-contained English, with no pointer only we can follow.
//
// THE PROTOCOL — three plain HTTP calls to the company's storage service, no credentials, open CORS:
//   1. POST <service>/pdp/piece/uploads          → 201, `Location: /pdp/piece/uploads/<uuid>`
//   2. PUT  <service>/pdp/piece/uploads/<uuid>   (the bytes)  → 204
//   3. POST <service>/pdp/piece/uploads/<uuid>   {"pieceCid": "<bafkzcib…>"}  → 200
// This is the same exchange `uploadPieceStreaming` in `@filoz/synapse-core/sp` performs. We write the
// three calls ourselves because importing that function also loads the library's error decoder,
// which carries every contract ABI the tooling knows — measured 2026-09-23 with esbuild: about
// 160 KB minified, of which 98 KB is that ABI table, for three requests that need none of it.
//
// ⛔ THE COMPANY IS UNTRUSTED, AND THAT IS FINE. The bytes are sealed (end-to-end encrypted) before
//    they get here, and the company checks them against the PieceCID we name in step 3. Nothing a
//    company does with this exchange can reveal a file or make the wrong bytes open as the right one.
//
// ⛔ NO RETRY IN HERE. Each attempt is a fresh upload session; the caller decides whether a failed
//    attempt is worth another (`order-runner.ts` does). A half-finished session is simply abandoned.
export class PieceUploadError extends Error {
    reason;
    /** The HTTP status that ended it, when a response was the reason. */
    status;
    constructor(reason, message, status = null) {
        super(message);
        this.name = "PieceUploadError";
        this.reason = reason;
        this.status = status;
    }
}
/** The bytes one piece may hold, at least and at most — the storage companies' own limits. */
const MIN_BYTES = 127;
const MAX_BYTES = 1_065_353_216;
/** `<service>/<path>`, whether or not the service origin was given with a trailing slash or a path. */
function endpoint(serviceUrl, path) {
    const base = serviceUrl.endsWith("/") ? serviceUrl : `${serviceUrl}/`;
    return new URL(path, base).toString();
}
function sizeOf(bytes) {
    return bytes instanceof Uint8Array ? bytes.byteLength : bytes.size;
}
/** Upload one part and have the company accept it under `pieceCid`. Resolves once step 3 answers 2xx. */
export async function uploadPieceToProvider(input) {
    const { serviceUrl, bytes, pieceCid, signal, onProgress } = input;
    const fetchImpl = input.fetchImpl ?? ((url, init) => fetch(url, init));
    let service;
    try {
        service = new URL(serviceUrl);
    }
    catch {
        // An unparsable address is the same refusal as a non-https one: nothing is sent to it.
        throw new PieceUploadError("not_https", `The storage service address "${serviceUrl}" is not a URL.`);
    }
    if (service.protocol !== "https:") {
        throw new PieceUploadError("not_https", `The storage service must be https, got ${service.protocol}`);
    }
    const total = sizeOf(bytes);
    if (total < MIN_BYTES || total > MAX_BYTES) {
        throw new PieceUploadError("size_out_of_range", `A piece must be ${MIN_BYTES}..${MAX_BYTES} bytes; this part is ${total}.`);
    }
    const withSignal = signal === undefined ? {} : { signal };
    // 1. Open an upload session.
    const created = await fetchImpl(endpoint(serviceUrl, "pdp/piece/uploads"), {
        method: "POST",
        ...withSignal,
    });
    if (created.status !== 201) {
        throw new PieceUploadError("session_refused", `The storage service did not open an upload (HTTP ${created.status}).`, created.status);
    }
    // ⚠ Readable across origins only when the company exposes it (`Access-Control-Expose-Headers`).
    const location = created.headers.get("Location");
    const uuid = location === null ? null : /\/pdp\/piece\/uploads\/([A-Fa-f0-9-]+)/.exec(location)?.[1];
    if (uuid === null || uuid === undefined) {
        throw new PieceUploadError("location_missing", location === null
            ? "The storage service opened an upload but did not say where (no Location header)."
            : `The storage service answered an upload address this client cannot read: ${location}`);
    }
    const sessionUrl = endpoint(serviceUrl, `pdp/piece/uploads/${uuid}`);
    // 2. Send the bytes.
    const put = input.put ??
        (async (req) => {
            const res = await fetchImpl(req.url, {
                method: "PUT",
                headers: { "Content-Type": "application/octet-stream" },
                body: req.body,
                ...(req.signal === undefined ? {} : { signal: req.signal }),
            });
            if (res.ok)
                req.onProgress?.(total, total);
            return res;
        });
    const sent = await put({
        url: sessionUrl,
        body: bytes,
        ...withSignal,
        ...(onProgress === undefined ? {} : { onProgress }),
    });
    if (!sent.ok) {
        throw new PieceUploadError("upload_refused", `The storage service refused the part's bytes (HTTP ${sent.status}).`, sent.status);
    }
    // 3. Name the bytes. The company recomputes the id from what it received and refuses a mismatch.
    const finalized = await fetchImpl(sessionUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pieceCid }),
        ...withSignal,
    });
    if (!finalized.ok) {
        throw new PieceUploadError("finalize_refused", `The storage service did not accept the part as ${pieceCid} (HTTP ${finalized.status}).`, finalized.status);
    }
}
