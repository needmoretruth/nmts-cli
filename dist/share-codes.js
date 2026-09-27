// The numbered public codes one NMTS key derives (NCF-3 §5.9).
//
// ⛔ EVERY NUMBER IS THE SAME KEY'S. Code 0 is the one every account has had from the start and comes
//    straight out of the key's derivation (`shareKeysOf`); code N ≥ 1 is expanded from the 32-byte
//    `shareIdRoot` slice of that derivation. Nothing is stored: the same key gives the same code at
//    the same number on any machine, which is why a revoked code's shares still open here.
//
// ⛔ A SHARE NAMES NO RECIPIENT NUMBER. The received listing says which code the server filed a share
//    under, and a handover file does not say at all, so `openShareAnyCode` tries the numbers it is
//    given in order. A wrong number fails exactly as any other refusal does, so trying several
//    weakens nothing.
//
// ⚠ THE KEY'S DERIVATION IS THE SLOW STEP — seconds, on purpose — and every number grows from its
//   output. So anything that touches more than one number goes through ONE ring (`shareKeyRing`),
//   which runs it once; `shareKeysAt` runs it for a single number.
import { DERIVED } from "./crypto.js";
import { NmtsError } from "./errors.js";
import { shareKeysFromDerived, shareKeysOf, unwrapWith } from "./share.js";
const IDENTITY_LEN = 4989;
const SEED_LEN = 32;
/** The largest number a code may carry — the server keeps it in a signed 32-bit column. */
export const CODE_INDEX_MAX = 2 ** 31 - 2;
/** A code number as a caller wrote it. Refused, never rounded: a neighbouring code is a different one. */
export function requireCodeIndex(value) {
    if (!Number.isSafeInteger(value) || value < 0 || value > CODE_INDEX_MAX) {
        throw new NmtsError(`A public code's number is a whole number from 0 to ${CODE_INDEX_MAX}.`, { exitCode: 2 });
    }
    return value;
}
/** Keys at N ≥ 1 from an already-sliced `shareIdRoot`. The caller wipes the root. */
function keysFromRoot(crypt, root, index) {
    const seeds = crypt.share_id_seeds(root, index);
    const kemSeed = seeds.slice(0, SEED_LEN);
    const authSecret = seeds.slice(SEED_LEN, 2 * SEED_LEN);
    const sigSeed = seeds.slice(2 * SEED_LEN, 3 * SEED_LEN);
    seeds.fill(0);
    const wipe = () => {
        kemSeed.fill(0);
        authSecret.fill(0);
        sigSeed.fill(0);
    };
    try {
        const identity = crypt.share_public_key_at(kemSeed, authSecret, sigSeed, index);
        if (identity.length !== IDENTITY_LEN) {
            throw new NmtsError(`Public code #${index}'s identity came out ${identity.length} bytes.`, {
                nextStep: "Nothing was sent. The crypto engine and this tool disagree about the format.",
            });
        }
        const address = crypt.share_address_at(sigSeed, index);
        return { index, kemSeed, authSecret, sigSeed, address, identity, display: crypt.share_address_display(address), wipe };
    }
    catch (error) {
        wipe();
        throw error;
    }
}
/** Run `body` with this key's `shareIdRoot`, wiped after. */
function withShareIdRoot(crypt, code, body) {
    const derived = crypt.kdf_derive(crypt.account_code_parse(code));
    const root = derived.slice(DERIVED.shareIdRoot[0], DERIVED.shareIdRoot[1]);
    derived.fill(0);
    try {
        return body(root);
    }
    finally {
        root.fill(0);
    }
}
/**
 * Everything sharing needs for public code number `index` — the same shape `shareKeysOf` answers,
 * which is exactly what it answers for 0. ⛔ The caller wipes it.
 */
export function shareKeysAt(crypt, code, index) {
    requireCodeIndex(index);
    if (index === 0)
        return shareKeysOf(crypt, code);
    return withShareIdRoot(crypt, code, (root) => keysFromRoot(crypt, root, index));
}
/**
 * The keys of several codes, from ONE run of the key's derivation, on first use. What stays between
 * uses is code 0's keys and the 32-byte root the other numbers grow from — never the rest of the
 * derivation. ⛔ `wipe()` wipes all of it.
 */
export function shareKeyRing(crypt, code) {
    const held = new Map();
    let root = null;
    const rootOf = () => {
        if (root !== null)
            return root;
        const derived = crypt.kdf_derive(crypt.account_code_parse(code));
        try {
            held.set(0, shareKeysFromDerived(crypt, derived));
            const made = derived.slice(DERIVED.shareIdRoot[0], DERIVED.shareIdRoot[1]);
            root = made;
            return made;
        }
        finally {
            derived.fill(0);
        }
    };
    return {
        at(index) {
            requireCodeIndex(index);
            const from = rootOf();
            const had = held.get(index);
            if (had !== undefined)
                return had;
            const made = keysFromRoot(crypt, from, index);
            held.set(index, made);
            return made;
        },
        wipe() {
            for (const keys of held.values())
                keys.wipe();
            held.clear();
            root?.fill(0);
            root = null;
        },
    };
}
/**
 * Open one envelope with whichever of `indices` it was sealed to, trying them in the order given.
 *
 * ⛔ ONE REFUSAL FOR EVERY FAILURE. Which number was tried and how it failed is not something to
 *    report: a wrong code, a tampered envelope and a sender who is not who it claims all fail the
 *    same way, and saying which would be telling somebody holding the file more than the file says.
 */
export function openShareAnyCode(crypt, code, indices, sealed) {
    const ring = shareKeyRing(crypt, code);
    try {
        return openShareWithRing(crypt, ring, indices, sealed);
    }
    finally {
        ring.wipe();
    }
}
/** `openShareAnyCode` with a ring the caller holds, and wipes. */
export function openShareWithRing(crypt, ring, indices, sealed) {
    for (const index of indices) {
        try {
            return { dek: unwrapWith(crypt, ring.at(index), sealed), index };
        }
        catch {
            // The next number, or the one refusal below.
        }
    }
    throw new NmtsError("It did not open with any of this account's public codes.", {
        exitCode: 1,
        nextStep: "Nothing was opened. The sender can seal it again to a public code this account holds.",
    });
}
