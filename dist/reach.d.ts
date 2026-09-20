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
/** What the caller has said. */
export declare function reach(): Reach;
/** Tell this package what the caller chose. Fields that are absent leave what was there. */
export declare function useReach(next: Reach): void;
/** Start again with nothing — the runtime's own addresses and its own `fetch`. For tests. */
export declare function forgetReach(): void;
/**
 * The one function every request in this package goes through.
 *
 * With nothing injected it is the runtime's `fetch`, called as the runtime's own — which is what
 * the command-line tool has always done, byte for byte.
 */
export declare const reachFetch: typeof fetch;
