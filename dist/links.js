// Public links (NCF-3 §5.8): make one, list them,
// cut one, and open one without an account — the code under `nmts link` and the SDK's four methods.
//
// A link is `<server>/l/<token>#<secret>`. The token names the server's row; the secret `S` opens the
// file key that row holds, and it is in the part after `#` that no server is sent. The shapes (link
// text, the sealed document) are the browser's own, copied byte for byte into `shared/`.
//
// ⛔ MAKING ONE SENDS NO SECRET. Every value in the request is an envelope made here: the file key
//    under `S`, the document and the digest under the file key (§5.4's two re-seals), and `S` under
//    this account's dataKey so the owner can print the same link again (`list`).
//
// ⛔ OPENING ONE ASKS FOR THE TOKEN AND NOTHING ELSE, with no session: whoever holds the link opens
//    the file. The pieces are read from Walrus as for any download, and the whole file is checked
//    against the digest the owner sealed before anything is delivered.
import { request, ServerError } from "./api.js";
import { fromBase64Url, fromUtf8, toBase64Url, utf8 } from "./bytes.js";
import { AAD, DERIVED, loadCrypto } from "./crypto.js";
import { fetchKnownParts } from "./download.js";
import { asParts } from "./download-part.js";
import { NmtsError } from "./errors.js";
import { isRecord } from "./guards.js";
import { buildPublicLink, decodeLinkDocument, encodeLinkDocument, linkExpiresAt, parsePublicLink, } from "./shared/lib/share/public-link.js";
/** Run `use` with this account's dataKey, and wipe it however `use` ends. */
async function withDataKey(crypt, code, use) {
    const derived = crypt.kdf_derive(crypt.account_code_parse(code));
    const dataKey = derived.slice(DERIVED.dataKey[0], DERIVED.dataKey[1]);
    derived.fill(0);
    try {
        return await use(dataKey);
    }
    finally {
        dataKey.fill(0);
    }
}
const text = (value) => (typeof value === "string" ? value : null);
/** Make a link to one file of the account's list. */
export async function makeLink(account, entry, options) {
    if (entry.dekWrapped === undefined || entry.contentHashCt === undefined) {
        const missing = entry.dekWrapped === undefined ? "key, so nobody could open the link" : "hash, so a download could not be checked";
        throw new NmtsError(`No link can be made to "${entry.name}": the file list holds no ${missing}.`, {
            exitCode: 4,
            nextStep: "Nothing was made.",
        });
    }
    const { dekWrapped, contentHashCt } = entry;
    const crypt = await loadCrypto();
    const secret = crypt.link_generate_secret();
    try {
        const body = await withDataKey(crypt, account.code, async (dataKey) => {
            const dek = crypt.envelope_open(dataKey, utf8(AAD.dekWrap), fromBase64Url(dekWrapped));
            const digest = crypt.envelope_open(dataKey, utf8(AAD.contentHash), fromBase64Url(contentHashCt));
            try {
                const doc = encodeLinkDocument({ name: options.showName ? entry.name : null, size: entry.size });
                const expiresAt = linkExpiresAt(options.expiresDays, options.now ?? new Date());
                return {
                    item_id: entry.id,
                    wrapped: toBase64Url(crypt.link_wrap_dek(secret, dek)),
                    name: toBase64Url(crypt.envelope_seal(dek, utf8(AAD.shareName), utf8(doc))),
                    disclosed_name: options.showName,
                    hash: toBase64Url(crypt.envelope_seal(dek, utf8(AAD.shareContentHash), digest)),
                    owner_secret: toBase64Url(crypt.link_seal_secret(dataKey, secret)),
                    ...(expiresAt === undefined ? {} : { expires_at: expiresAt }),
                };
            }
            finally {
                dek.fill(0);
                digest.fill(0);
            }
        });
        const answer = await request(account.server, "/v1/share-links", { method: "POST", body, token: account.bearer });
        const id = isRecord(answer) ? text(answer["link_id"]) : null;
        const createdAt = isRecord(answer) ? text(answer["created_at"]) : null;
        if (id === null || createdAt === null) {
            throw new NmtsError("The server's answer did not name the new link.");
        }
        return {
            link: buildPublicLink(account.server, id, toBase64Url(secret)),
            id,
            createdAt,
            expiresAt: isRecord(answer) ? text(answer["expires_at"]) : null,
        };
    }
    finally {
        secret.fill(0);
    }
}
/** Every link the account made to one file, newest first, cut ones included. */
export async function listLinks(account, itemId) {
    const answer = await request(account.server, `/v1/share-links?item_id=${encodeURIComponent(itemId)}`, {
        token: account.bearer,
    });
    const rows = isRecord(answer) ? answer["links"] : null;
    if (!Array.isArray(rows))
        throw new NmtsError("The server listed the links in a shape this version cannot read.");
    const crypt = await loadCrypto();
    return withDataKey(crypt, account.code, async (dataKey) => rows.map((row) => {
        if (!isRecord(row))
            throw new NmtsError("The server listed the links in a shape this version cannot read.");
        const id = text(row["link_id"]) ?? "";
        const cutAt = text(row["revoked_at"]);
        const sealed = text(row["owner_secret"]);
        let link = null;
        if (cutAt === null && sealed !== null) {
            try {
                const secret = crypt.link_open_secret(dataKey, fromBase64Url(sealed));
                link = buildPublicLink(account.server, id, toBase64Url(secret));
                secret.fill(0);
            }
            catch {
                // A secret that does not open is a row without a link, not a list that fails.
                link = null;
            }
        }
        return {
            id,
            link,
            showsName: row["disclosed_name"] === true,
            createdAt: text(row["created_at"]) ?? "",
            expiresAt: text(row["expires_at"]),
            cutAt,
            cutBy: text(row["revoked_by"]),
            downloads: typeof row["downloads"] === "number" ? row["downloads"] : 0,
        };
    }));
}
/** Cut one of the account's links. Cutting one that is already cut is not an error. */
export async function revokeLink(account, id) {
    await request(account.server, `/v1/share-links/${encodeURIComponent(id)}`, { method: "DELETE", token: account.bearer });
}
/**
 * Open a link and deliver its file to `sink`, checked against the owner's digest. No account.
 *
 * `name` is told the file's name (or null) before a byte is fetched, so the caller can pick the sink.
 */
export async function openLink(input) {
    const parts = parsePublicLink(input.link);
    if (parts === null) {
        throw new NmtsError("That is not a whole public link.", {
            exitCode: 2,
            nextStep: "Copy all of it, including the part after #: a link ends in /l/<token>#<secret>.",
        });
    }
    let answer;
    try {
        answer = await request(input.server, `/v1/share-links/${encodeURIComponent(parts.token)}`);
    }
    catch (error) {
        if (error instanceof ServerError && error.status === 404)
            throw new NmtsError("This link does not exist.", { exitCode: 4 });
        if (error instanceof ServerError && error.status === 410)
            throw new NmtsError("This link has been cut.", { exitCode: 4 });
        throw error;
    }
    if (!isRecord(answer))
        throw new NmtsError("The server's answer was not an object.");
    const wrapped = text(answer["wrapped"]);
    const sealedName = text(answer["name"]);
    const sealedHash = text(answer["hash"]);
    if (wrapped === null || sealedName === null || sealedHash === null) {
        throw new NmtsError("The server described this link in a shape this version cannot read.");
    }
    const network = answer["network"] === "mainnet" || answer["network"] === "testnet" ? answer["network"] : input.chain;
    const described = asParts(answer);
    const crypt = await loadCrypto();
    const secret = fromBase64Url(parts.secret);
    let dek;
    try {
        dek = crypt.link_unwrap_dek(secret, fromBase64Url(wrapped));
    }
    catch {
        throw new NmtsError("This link is incomplete or damaged: the part after # does not open the file.", {
            exitCode: 4,
            nextStep: "Nothing was fetched. Ask the person who sent it for the whole link.",
        });
    }
    finally {
        secret.fill(0);
    }
    let digest;
    let doc;
    try {
        doc = decodeLinkDocument(fromUtf8(crypt.envelope_open(dek, utf8(AAD.shareName), fromBase64Url(sealedName))));
        digest = crypt.envelope_open(dek, utf8(AAD.shareContentHash), fromBase64Url(sealedHash));
    }
    catch {
        doc = null;
        digest = new Uint8Array(0);
    }
    if (doc === null || digest.length === 0) {
        dek.fill(0);
        throw new NmtsError("This link is damaged: the file's name and size stored with it do not open.", {
            exitCode: 4,
            nextStep: "Nothing was fetched. Ask the person who sent it for a new link.",
        });
    }
    const fetched = await fetchKnownParts({
        parts: [...described.parts].sort((a, b) => a.part_index - b.part_index),
        size: doc.size,
        dek,
        expected: digest,
        chain: network,
        sink: input.sink(doc.name),
        ...(input.read === undefined ? {} : { read: input.read }),
    });
    return { name: doc.name, bytes: fetched.byteCount, parts: fetched.partCount };
}
