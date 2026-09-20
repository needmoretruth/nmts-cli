// Where this program talks, and what it talks through — the caller's answer, not the runtime's.
//
// ⛔ WHY THIS IS NOT THE HOST. `host.ts` holds what a RUNTIME provides: an engine, a store, an
//    environment, somewhere for progress to go, a zstd encoder. What is here is what a CALLER
//    chose: a relay, a set of Sui nodes, a set of aggregators, and the function every request goes
//    through. The command-line tool sets none of it and reads its addresses out of the environment
//    exactly as it always has; a library's caller has no environment to write, and until this file
//    existed the options it passed for two of those addresses were read only by the browser host —
//    silently ignored on Node, which is the defect this fixes.
//
// ⛔ AN OPTION THAT WAS PASSED IS HONOURED ON EVERY HOST, or refused by name. Nothing in this
//    package may quietly reach an address the caller did not choose: for somebody routing their
//    traffic through a proxy, one leak makes the proxy a lie rather than a weaker promise.
//
// ⛔ IT IS READ AT THE MOMENT OF THE REQUEST, not copied when a client is made. `reachFetch` looks
//    the function up on every call, so a caller that set one after building its client is not
//    holding a stale copy.
//
// ⚠ ONE PER PROCESS, AND THE LAST WRITER WINS THE FIELDS IT NAMES. This is the same arrangement
//   the SDK's `host-options.ts` already describes for a page: two clients pointed at different
//   relays would be two answers to a question with one answer. On a server that means two clients
//   with two different proxies share whichever was set last — said here rather than discovered.
//
// ⛔ NO `node:` IMPORT, EVER. This file is reachable from `portable.ts`, which promises that.
let current = {};
/** What the caller has said. */
export function reach() {
    return current;
}
/** Tell this package what the caller chose. Fields that are absent leave what was there. */
export function useReach(next) {
    const merged = { ...current };
    for (const key of Object.keys(next)) {
        if (next[key] !== undefined)
            Reflect.set(merged, key, next[key]);
    }
    current = merged;
}
/** Start again with nothing — the runtime's own addresses and its own `fetch`. For tests. */
export function forgetReach() {
    current = {};
}
/**
 * The one function every request in this package goes through.
 *
 * With nothing injected it is the runtime's `fetch`, called as the runtime's own — which is what
 * the command-line tool has always done, byte for byte.
 */
export const reachFetch = (input, init) => {
    const given = current.fetch;
    return given === undefined ? globalThis.fetch(input, init) : given(input, init);
};
