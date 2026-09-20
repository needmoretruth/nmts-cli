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

/** What a caller may say about where this client talks, and what it talks through. */
export interface Reach {
  /**
   * The storage network's upload relay to write through, instead of the network's own.
   *
   * ⚠ ONE host, not a list: the relay is named inside the transaction that pays its tip, so a
   *   write picks its host before the storage is bought and never moves.
   */
  relay?: string | undefined;
  /**
   * The Sui JSON-RPC endpoints to ask, in order, instead of the network's own.
   *
   * ⛔ IT REPLACES THE LIST rather than adding to it — somebody who names a node is saying *those*,
   *    and quietly reaching a public mirror as well would send their traffic somewhere they did
   *    not choose.
   */
  suiRpc?: readonly string[] | undefined;
  /** Hosts to read stored bytes from, instead of the public aggregators for the network. */
  aggregators?: readonly string[] | undefined;
  /**
   * The function every request this package makes goes through. Absent, the runtime's own.
   *
   * It is where a proxy goes: an agent, a SOCKS tunnel, a recorder, a counter. Nothing about a
   * proxy is built into this package, because one function is the whole of what it would need.
   */
  fetch?: typeof fetch | undefined;
}

let current: Reach = {};

/** What the caller has said. */
export function reach(): Reach {
  return current;
}

/** Tell this package what the caller chose. Fields that are absent leave what was there. */
export function useReach(next: Reach): void {
  const merged: Reach = { ...current };
  for (const key of Object.keys(next) as (keyof Reach)[]) {
    if (next[key] !== undefined) Reflect.set(merged, key, next[key]);
  }
  current = merged;
}

/** Start again with nothing — the runtime's own addresses and its own `fetch`. For tests. */
export function forgetReach(): void {
  current = {};
}

/**
 * The one function every request in this package goes through.
 *
 * With nothing injected it is the runtime's `fetch`, called as the runtime's own — which is what
 * the command-line tool has always done, byte for byte.
 */
export const reachFetch: typeof fetch = (input, init) => {
  const given = current.fetch;
  return given === undefined ? globalThis.fetch(input, init) : given(input, init);
};
