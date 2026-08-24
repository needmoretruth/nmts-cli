// Sharing one file with one other account: what gets sealed, in what order, and why that order.
//
// ⛔ NOTHING HERE TRUSTS THE SERVER WITH A KEY. A share hands a recipient the file's own key,
//    wrapped so that only they can open it. The server stores an opaque envelope and three sealed
//    fields; it can open none of them, and it cannot tell whether a share it stored is one that
//    was actually made.
//
// ⛔ THE ORDER IS LOAD-BEARING. The name and the digest are sealed FIRST, and the exact bytes that
//    result are hashed into the key that wraps the file key. So a name sealed afterwards, or one
//    byte different from what is actually sent, produces an envelope the recipient cannot open.
//    That is what stops a server rewriting the name a file arrived under: it would have to produce
//    a wrapping key it does not have.
//
// ⛔ OPENING IT IS THE AUTHENTICATION. There is no separate signature to check. The sender's own
//    secret is inside the key agreement, so an envelope that opens at all could only have been
//    made by the account it names. The claimed sender is therefore printed only AFTER the open
//    succeeds — before that it is a claim, and printing a claim as a fact is how somebody trusts
//    a file that was not sent by who it says.
import { AAD, DERIVED } from "./crypto.js";
import { NmtsError } from "./errors.js";
import { decodeSharedFileInfo, encodeSharedFileInfo, } from "./shared/lib/share/shared-file-info.js";
const encoder = new TextEncoder();
/** Exact sizes the server checks. Named here so a wrong one is caught before a round trip. */
const ENVELOPE_LEN = 1240;
const DIGEST_ENVELOPE_LEN = 104;
const IDENTITY_LEN = 4989;
/** Derive everything sharing needs from an account code. */
export function shareKeysOf(crypt, code) {
    const derived = crypt.kdf_derive(crypt.account_code_parse(code));
    const slice = (range) => derived.slice(range[0], range[1]);
    const kemSeed = slice(DERIVED.shareKemSeed);
    const authSecret = slice(DERIVED.shareAuthSecret);
    const sigSeed = slice(DERIVED.shareSigSeed);
    const address = slice(DERIVED.shareAddress);
    derived.fill(0);
    const identity = crypt.share_public_key(kemSeed, authSecret, sigSeed);
    if (identity.length !== IDENTITY_LEN) {
        throw new NmtsError(`This account's sharing identity came out ${identity.length} bytes.`, {
            nextStep: "Nothing was sent. The crypto engine and this tool disagree about the format.",
        });
    }
    return {
        kemSeed,
        authSecret,
        sigSeed,
        address,
        identity,
        display: crypt.share_address_display(address),
        wipe() {
            kemSeed.fill(0);
            authSecret.fill(0);
            sigSeed.fill(0);
        },
    };
}
/**
 * Seal one file for one recipient.
 *
 * `recipientIdentity` is checked against `recipientAddress` inside the engine before anything is
 * encrypted to it — length, fingerprint, self-signature and key decoding — which is why both are
 * arguments and why there is no form of this that takes the identity alone. A tool that fetched an
 * identity and wrapped to it without naming the address it asked for would hand a readable key to
 * whoever answered.
 */
export function sealShare(crypt, input) {
    if (input.digest.length !== 32) {
        throw new NmtsError("This file has no recorded content hash, so it cannot be shared.", {
            nextStep: "A share carries a hash the recipient checks the bytes against. Without one there is " +
                "nothing to check, and a share that proves nothing is not one this tool will make.",
        });
    }
    // ⛔ SEALED FIRST, AND THESE EXACT BYTES ARE WHAT GETS SENT. See the module note.
    const nameCt = crypt.envelope_seal(input.dek, encoder.encode(AAD.shareName), encoder.encode(encodeSharedFileInfo({ name: input.name, size: input.size })));
    const digestCt = crypt.envelope_seal(input.dek, encoder.encode(AAD.shareContentHash), input.digest);
    if (digestCt.length !== DIGEST_ENVELOPE_LEN) {
        throw new NmtsError(`A sealed content hash came out ${digestCt.length} bytes.`);
    }
    const envelope = crypt.share_wrap_dek(input.keys.authSecret, input.keys.sigSeed, input.recipientIdentity, input.recipientAddress, input.dek, input.itemId, nameCt, digestCt);
    if (envelope.length !== ENVELOPE_LEN) {
        throw new NmtsError(`A share envelope came out ${envelope.length} bytes.`);
    }
    return {
        dek_share_ct: Buffer.from(envelope).toString("base64url"),
        name_share_ct: Buffer.from(nameCt).toString("base64url"),
        content_hash_share_ct: Buffer.from(digestCt).toString("base64url"),
    };
}
/**
 * Open one received share.
 *
 * ⛔ A ROW THAT WILL NOT OPEN IS STILL RETURNED. Dropping it would tell the account it was sent
 *    less than it was, and the honest answer to "this one will not open" is to say so on its own
 *    line — not to leave a gap somebody has no way to notice.
 */
export function openReceived(crypt, keys, row) {
    const base = {
        id: row.id,
        itemId: row.item_id,
        createdAt: row.created_at,
        digestCt: row.content_hash_share_ct,
    };
    const unopened = (problem) => ({
        ...base,
        name: null,
        size: null,
        sender: null,
        dek: null,
        problem,
    });
    if (row.sender_public_key === undefined || row.sender_public_key === "") {
        // The sender's identity is what the open is checked against. Without it there is nothing to
        // authenticate against, and an unauthenticated open is not one worth doing.
        return unopened("the sender's published identity is not available");
    }
    const envelope = new Uint8Array(Buffer.from(row.dek_share_ct, "base64url"));
    const nameCt = new Uint8Array(Buffer.from(row.name_share_ct, "base64url"));
    const digestCt = new Uint8Array(Buffer.from(row.content_hash_share_ct, "base64url"));
    const senderPublic = new Uint8Array(Buffer.from(row.sender_public_key, "base64url"));
    let dek;
    try {
        dek = crypt.share_unwrap_dek(keys.kemSeed, keys.authSecret, keys.sigSeed, senderPublic, envelope, row.item_id, nameCt, digestCt);
    }
    catch {
        return unopened("it did not open with this account's keys");
    }
    // ⛔ ONLY NOW. Before the unwrap succeeded this was a claim printed next to a file name, which is
    //    exactly how somebody comes to trust a file that was not sent by who it says.
    let sender;
    try {
        sender = crypt.share_address_display(crypt.share_claimed_sender(envelope));
    }
    catch {
        dek.fill(0);
        return unopened("the sender it names is not a readable address");
    }
    let info;
    try {
        info = decodeSharedFileInfo(new TextDecoder().decode(crypt.envelope_open(dek, encoder.encode(AAD.shareName), nameCt)));
    }
    catch {
        dek.fill(0);
        return unopened("the file's name did not open");
    }
    return {
        ...base,
        name: info.name,
        size: info.size ?? null,
        sender,
        dek,
        problem: null,
    };
}
/** The digest a recipient checks the downloaded bytes against. */
export function openSharedDigest(crypt, dek, digestCt) {
    try {
        return crypt.envelope_open(dek, encoder.encode(AAD.shareContentHash), new Uint8Array(Buffer.from(digestCt, "base64url")));
    }
    catch {
        return null;
    }
}
/**
 * Turn what a person typed into the 16 bytes behind a public code.
 *
 * ⛔ A TYPO FAILS HERE, NOT AS A LOOKUP. Sending a mistyped address to the server would ask it a
 *    question about somebody who might exist, and the answer is not ours to collect.
 */
export function addressFromTyped(crypt, typed) {
    try {
        return crypt.share_address_parse(typed.trim());
    }
    catch {
        throw new NmtsError(`"${typed.trim()}" is not a public code.`, {
            exitCode: 2,
            nextStep: "Nothing was sent. An address has a check symbol built in, so this was caught here " +
                "rather than by asking the server about it.",
        });
    }
}
/**
 * Check that an identity the server handed back is the one that was asked for.
 *
 * The engine checks this again inside the wrap, and this exists so the refusal says WHICH thing
 * was wrong rather than failing inside a sealing step.
 */
export function identityMatches(crypt, identity, address) {
    if (identity.length !== IDENTITY_LEN)
        return false;
    try {
        return Buffer.from(crypt.share_address_of(identity)).equals(Buffer.from(address));
    }
    catch {
        return false;
    }
}
