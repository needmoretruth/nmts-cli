// Which of this account's public codes a handover is made from, and which one opens it.
//
// ⛔ A HANDOVER FILE NAMES NO RECIPIENT NUMBER. The envelope was sealed to one of this key's codes
//    and does not say which, so opening tries them: code 0 first — the code every account starts
//    with, and the one every file made before numbered codes was sealed to — then, when a credential
//    on this machine can read the account's list, the live codes lowest first and the revoked ones
//    newest first; with no credential, 1, 2, … up to `OFFLINE_WALK`. A wrong number fails exactly as
//    any other refusal does, so trying several tells nobody anything.
//
// ⛔ MAKING ONE SENDS FROM A LIVE CODE. A revoked code that went on sending would leave its
//    recipients unable to trust a revocation; the server refuses that for shares, and a handover has
//    no server to refuse it, so this does.
import { toBase64Url } from "./bytes.js";
import { resolveApiKey } from "./credentials.js";
import { notForThisKey } from "./handover.js";
import { codeNumber, differentCode, notLiveCode } from "./public-code-refusals.js";
import { liveCodes, readPublicCodes } from "./public-codes.js";
import { openShareWithRing, shareKeyRing, shareKeysAt } from "./share-codes.js";
/** How many numbers after 0 opening tries when it cannot read the account's list. */
export const OFFLINE_WALK = 64;
/**
 * The number a handover is sent from: `--as`, or the lowest-numbered live code. An account that has
 * never published sends from code 0, the code its key has always had.
 */
export function senderIndexOf(list, as) {
    const wanted = as === undefined ? undefined : codeNumber(as, "--as");
    if (list.codes.length === 0) {
        if (wanted !== undefined && wanted !== 0)
            throw notLiveCode(wanted);
        return 0;
    }
    const live = liveCodes(list);
    const row = wanted === undefined ? live[0] : live.find((c) => c.index === wanted);
    if (row === undefined)
        throw notLiveCode(wanted ?? 0);
    return row.index;
}
/** The keys at `index`, refused by name when the server lists another code at that number. */
export function checkedKeys(crypt, code, list, index) {
    const keys = shareKeysAt(crypt, code, index);
    const row = list.codes.find((c) => c.index === index);
    if (row !== undefined && toBase64Url(keys.address) !== row.address) {
        keys.wipe();
        throw differentCode();
    }
    return keys;
}
/** Whether `address` is one of this account's codes — live, revoked, or the one it is sending from. */
export function isMine(list, keys, address) {
    const wire = toBase64Url(address);
    return wire === toBase64Url(keys.address) || list.codes.some((c) => c.address === wire);
}
/** The numbers to try after 0: live ascending, then revoked newest first. */
function laterCodes(list) {
    const live = liveCodes(list).map((c) => c.index);
    const revoked = list.codes
        .filter((c) => c.revokedAt !== null)
        .sort((a, b) => (b.revokedAt ?? "").localeCompare(a.revokedAt ?? "") || b.index - a.index)
        .map((c) => c.index);
    return [...live, ...revoked].filter((i) => i !== 0);
}
/** The account's list, when a credential on this machine can read it; null otherwise. */
async function listIfHeld(server) {
    const key = resolveApiKey();
    if (key === null)
        return null;
    try {
        return await readPublicCodes(server, key.key);
    }
    catch {
        return null;
    }
}
/** Open a handover envelope with whichever of this account's codes it was sealed to. */
export async function openWithMyCodes(crypt, code, sealed, server) {
    // ⛔ ONE RING: the key's derivation runs once however many numbers are tried.
    const ring = shareKeyRing(crypt, code);
    try {
        let found;
        let list = null;
        try {
            found = openShareWithRing(crypt, ring, [0], sealed);
        }
        catch {
            list = await listIfHeld(server);
            const order = list === null ? Array.from({ length: OFFLINE_WALK }, (_, i) => i + 1) : laterCodes(list);
            try {
                found = openShareWithRing(crypt, ring, order, sealed);
            }
            catch {
                throw notForThisKey();
            }
        }
        const keys = ring.at(found.index);
        const row = list?.codes.find((c) => c.index === found.index);
        return {
            ...found,
            display: keys.display,
            address: keys.address.slice(),
            revoked: row === undefined ? null : row.revokedAt !== null,
        };
    }
    finally {
        ring.wipe();
    }
}
