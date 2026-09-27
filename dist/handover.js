// Handing one file to one account OUTSIDE NMTS: a share that travels as a file instead of a server
// row (NCF-3 §5.6), and the public code file that lets a sender make one without asking the server
// for the recipient's identity (§5.7).
//
// ⛔ NOTHING NEW IS BUILT HERE. The envelope and the sealed digest come from `sealShare` — the same
//    bytes a built-in share posts. The name document is the share's, extended by two values, and the
//    only extra sealed value is the list of stored pieces, under the file's own key with its own
//    label. The text around them is the shared format module, byte for byte the one the browser
//    uses, so both programs accept and refuse the same files.
//
// ⛔ THE PARTS LIST AND THE NETWORK ARE BOUND THROUGH THE NAME. The parts are sealed first, and
//    their SHA-256 and the network go into the name document, which the envelope covers. A reader
//    compares both after opening the name; without that, anyone holding the file key could hand the
//    recipient a list of their own choosing under the real sender's name.
//
// ⛔ OPENING ONE ASKS THE NMTS SERVER NOTHING. Everything the recipient needs is in the file; the
//    pieces come from Walrus aggregators.
//
// ⛔ THE SENDER IS NAMED ONLY AFTER THE ENVELOPE OPENED, as for a received share: the file names
//    its sender twice (the identity it carries and the envelope's first 16 bytes), the two must
//    agree, and the unwrap then proves that sender made it.
import { createHash } from "node:crypto";
import { AAD } from "./crypto.js";
import { NmtsError } from "./errors.js";
import { addressFromTyped, identityMatches, sealShare } from "./share.js";
import { decodeHandover, decodeHandoverName, decodePartsList, decodePublicCodeFile, earliestExpiry, encodeHandover, encodeHandoverName, encodePartsList, encodePublicCodeFile, handoverNameFits, HandoverFormatError, } from "./shared/lib/share/handover-format.js";
const encoder = new TextEncoder();
const b64 = (bytes) => Buffer.from(bytes).toString("base64url");
const bytesOf = (text) => new Uint8Array(Buffer.from(text, "base64url"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("base64url");
/** A stand-in digest of the right length, to ask whether a name fits before anything is sealed. */
const DIGEST_PLACEHOLDER = "A".repeat(43);
export function isHandoverNetwork(value) {
    return value === "mainnet" || value === "testnet";
}
/** Refuse a name the handover file cannot carry, before any work is done. */
export function checkHandoverName(name, size, network) {
    let fits = false;
    try {
        fits = handoverNameFits(encodeHandoverName({ name, size, network, partsSha256: DIGEST_PLACEHOLDER }));
    }
    catch {
        fits = false;
    }
    if (!fits) {
        throw new NmtsError("This file's name is too long to hand over.", {
            exitCode: 2,
            nextStep: "Nothing was written. Rename it with `nmts mv`, then try again.",
        });
    }
}
/** Build a handover file's text. The caller holds the file key and the digest, and wipes them. */
export function makeHandoverText(crypt, input) {
    checkHandoverName(input.name, input.size, input.network);
    try {
        // The engine lowercases the id before binding it; the file carries that same spelling.
        const item = input.itemId.toLowerCase();
        // ⚠ ORDER: parts first — their digest goes into the name, and the name into the envelope.
        const parts = crypt.envelope_seal(input.dek, encoder.encode(AAD.handoverParts), encoder.encode(encodePartsList(input.parts)));
        const nameDocument = encodeHandoverName({
            name: input.name,
            size: input.size,
            network: input.network,
            partsSha256: sha256(parts),
        });
        const sealed = sealShare(crypt, { ...input, itemId: item, nameDocument });
        return encodeHandover({
            network: input.network,
            item,
            sender: b64(input.keys.identity),
            envelope: sealed.dek_share_ct,
            name: sealed.name_share_ct,
            hash: sealed.content_hash_share_ct,
            parts: b64(parts),
        });
    }
    catch (error) {
        if (error instanceof NmtsError)
            throw error;
        const field = error instanceof HandoverFormatError && error.field !== null ? ` (${error.field})` : "";
        throw new NmtsError(`Could not make the handover file${field}.`, {
            exitCode: 1,
            nextStep: "Nothing was written. The file's stored pieces are not in a form a handover can carry.",
        });
    }
}
/** Open a handover file's text with this account's keys. */
export function openHandoverText(crypt, keys, text, network) {
    let file;
    try {
        file = decodeHandover(text, network);
    }
    catch (error) {
        throw readRefusal(error, network);
    }
    const damaged = new NmtsError("This handover file is damaged: its fields do not hold together.", {
        exitCode: 1,
        nextStep: "Nothing was written. Ask the sender to send it again.",
    });
    const senderIdentity = bytesOf(file.sender);
    const envelope = bytesOf(file.envelope);
    let claimed;
    try {
        claimed = crypt.share_claimed_sender(envelope);
    }
    catch {
        throw damaged;
    }
    if (!identityMatches(crypt, senderIdentity, claimed))
        throw damaged;
    const nameCt = bytesOf(file.name);
    const digestCt = bytesOf(file.hash);
    const partsCt = bytesOf(file.parts);
    let dek;
    try {
        dek = crypt.share_unwrap_dek(keys.kemSeed, keys.authSecret, keys.sigSeed, senderIdentity, envelope, file.item, nameCt, digestCt);
    }
    catch {
        throw new NmtsError("This file does not open with your NMTS key.", {
            exitCode: 4,
            nextStep: "Nothing was written. It was made for another key, or it was changed after it was made.",
        });
    }
    try {
        const named = decodeHandoverName(new TextDecoder().decode(crypt.envelope_open(dek, encoder.encode(AAD.shareName), nameCt)));
        if (named.network !== file.network || named.partsSha256 !== sha256(partsCt))
            throw damaged;
        const parts = decodePartsList(new TextDecoder().decode(crypt.envelope_open(dek, encoder.encode(AAD.handoverParts), partsCt)));
        const digest = crypt.envelope_open(dek, encoder.encode(AAD.shareContentHash), digestCt);
        return {
            name: named.name,
            size: named.size,
            sender: crypt.share_address_display(claimed),
            parts,
            expiryEpoch: earliestExpiry(parts),
            dek,
            digest,
        };
    }
    catch {
        dek.fill(0);
        throw damaged;
    }
}
/** This account's public code file. */
export function publicCodeFileText(keys) {
    return encodePublicCodeFile({ code: keys.display, identity: b64(keys.identity) });
}
/**
 * Read a recipient's public code file. Returns only when the identity inside really fingerprints to
 * the code the file names, so what is sealed to is what the person was told.
 */
export function readPublicCodeFileText(crypt, text) {
    let file;
    try {
        file = decodePublicCodeFile(text);
    }
    catch (error) {
        if (error instanceof HandoverFormatError && error.problem === "unknown-version") {
            throw new NmtsError("This public code file is from a newer version of NMTS.", {
                exitCode: 4,
                nextStep: "Nothing was written. Update this tool and try again.",
            });
        }
        throw new NmtsError("This is not a valid public code file.", { exitCode: 2, nextStep: "Nothing was written." });
    }
    const address = addressFromTyped(crypt, file.code);
    const identity = bytesOf(file.identity);
    if (!identityMatches(crypt, identity, address)) {
        throw new NmtsError("The identity in this public code file does not belong to the public code it names.", {
            exitCode: 1,
            nextStep: "Nothing was written. Sealing to it would hand the file to somebody else; ask the recipient for their file again.",
        });
    }
    return { identity, address, display: crypt.share_address_display(address) };
}
/** A handover file the format module refused, said the way §5.6 sorts it. */
function readRefusal(error, network) {
    const problem = error instanceof HandoverFormatError ? error.problem : "not-json";
    switch (problem) {
        case "unknown-version":
            return new NmtsError("This handover file is from a newer version of NMTS.", {
                exitCode: 4,
                nextStep: "Nothing was written. Update this tool and try again.",
            });
        case "other-network":
            return new NmtsError(`This handover file was made on the other network; this tool is on ${network}.`, {
                exitCode: 4,
                nextStep: "Nothing was written. Open it with --network set to the network it was made on.",
            });
        case "bad-field":
            return new NmtsError("This handover file is damaged: a field was cut or changed.", {
                exitCode: 1,
                nextStep: "Nothing was written. Ask the sender to send it again.",
            });
        default:
            return new NmtsError("This is not a handover file.", { exitCode: 2, nextStep: "Nothing was written." });
    }
}
