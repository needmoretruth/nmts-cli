/**
 * The roads an upload from this tool can take (D50 · D51, 2026-11-09).
 *
 * ⭐ ORDER (owner, 2026-11-09). Mysten Labs' relay; when it does not answer, the Walrus storage
 *    nodes straight from this machine (`NODE_ROAD`, no relay, no tip); NMTS's own relay last, only
 *    for a part the direct write could not carry. The own relay is a server the owner pays for and
 *    shares with the site, so it is the road taken when nothing else carried the bytes.
 *    Between them, the other company relays of `RELAY_HOSTS` (Studio Mirai since 2026-11-10, found by
 *    a live probe; the registry lists no relays). On a wallet upload the person pays that relay's tip
 *    and sees it before signing. On a credit upload the treasury pays it only while its tip fits the
 *    credit ceiling at every size (`credit-tip.ts`, three times Mysten's formula; the chain service
 *    refuses above it), because this road is chosen before the size is known.
 *
 * ⭐ THE TWO LAST ROADS COST THE SAME AND CUT THE SAME. Neither takes a tip, and both send 64 MiB
 *    parts, so the price shown before the first signature holds whichever of them carries a part,
 *    and the registration a part was bought with serves either.
 *
 * ⛔ WHY. Every upload reached Walrus through Mysten Labs' relay alone; the day it stops answering,
 *    nobody can upload. NMTS runs the same relay software (Mysten's image, no tip) behind its own
 *    api at `/v1/relay`. This tool asks Mysten's relay once, before anything is priced, and takes
 *    the own road only when that relay refuses or does not answer. A relay the caller or the
 *    environment named is never second-guessed.
 *
 * ⛔ CHOSEN BEFORE THE PRICE. The own relay holds about five times a blob in memory (measured
 *    2026-11-09: 64 MiB → 354 MiB peak), so on that road a file is cut into 64 MiB parts, and the
 *    credits quoted are the credits of those parts. A road chosen after a quote would charge a number
 *    nobody was shown; this module is asked first and the part size follows from its answer.
 *
 * The same path and part size as the browser's (`web/src/lib/walrus/own-relay.ts`); the route
 * table (`deploy/core-routes.json`) names both.
 */
import { reachFetch } from "./reach.js";
import { RELAY_HOSTS, relayHost } from "./walrus.js";
import { creditTipFitsEverySize, tipLine } from "./shared/lib/walrus/credit-tip.js";
import { parseTipConfig } from "./shared/lib/walrus/tip-config.js";
/** Where the own relay answers, after the NMTS server's address. */
export const OWN_RELAY_PATH = "/v1/relay";
/** The part size on the own road: an existing preset, the size whose relay peak fits the server. */
export const OWN_RELAY_PART_BYTES = 64 * 2 ** 20;
/** How long Mysten's relay gets to answer before this run takes the own road. */
export const ROAD_PROBE_TIMEOUT_MS = 10_000;
/**
 * The "relay address" of the direct road: no host, the storage nodes themselves (D51). The same
 * value as the browser's (`web/src/lib/walrus/node-road.ts`), and it is what a resumable upload's
 * record keeps, so a resumed part goes back to the nodes.
 */
export const NODE_ROAD = "walrus:storage-nodes";
/** True for the direct road. */
export function isNodeRoad(relayUrl) {
    return relayUrl === NODE_ROAD;
}
/** True for a road that takes no tip: the own relay and the storage nodes. */
export function isTipFree(relayUrl) {
    return isNodeRoad(relayUrl) || isOwnRelay(relayUrl);
}
let chosen = null;
/** A company relay after Mysten's, taken when Mysten's did not answer (D51). */
let companyRelay = null;
/** True for the own relay's address on any NMTS server. */
export function isOwnRelay(relayUrl) {
    return relayUrl.replace(/\/+$/, "").endsWith(OWN_RELAY_PATH);
}
/**
 * Decide this run's road, once, before anything is priced. True when a small road (the storage
 * nodes, or the own relay) was taken.
 *
 * `probe` is the request that asks Mysten's relay (tests pass a fake one). `nodeRoad: false` is a
 * machine that cannot write to the storage nodes itself; it goes to the own relay, as before D51.
 */
export async function chooseUploadRoad(input) {
    chosen = null;
    companyRelay = null;
    const relays = RELAY_HOSTS[input.network] ?? [];
    const known = relays[0];
    // A caller or an environment that named a relay chose it; nothing is asked.
    if (known === undefined || relayHost(input.network) !== known)
        return false;
    const probe = input.probe ?? reachFetch;
    const answers = async (relay) => {
        try {
            const res = await probe(`${relay}/v1/tip-config`, {
                signal: AbortSignal.timeout(input.timeoutMs ?? ROAD_PROBE_TIMEOUT_MS),
            });
            if (!res.ok)
                return false;
            // Mysten's own price is the reference; another company's must fit the credit ceiling.
            if (input.credit !== true || relay === known)
                return true;
            const line = tipLine(parseTipConfig(await res.json()));
            return line !== null && creditTipFitsEverySize(line);
        }
        catch {
            return false;
        }
    };
    // Asked together, so a dead relay costs one timeout, not one each; Mysten's answer wins.
    const others = input.otherCompanies === true || input.credit === true ? relays.slice(1) : [];
    const answered = await Promise.all([known, ...others].map(answers));
    if (answered[0])
        return false;
    const other = others.find((_, i) => answered[i + 1]);
    if (other !== undefined) {
        companyRelay = other;
        return false;
    }
    const ownUrl = `${input.server.replace(/\/+$/, "")}${OWN_RELAY_PATH}`;
    chosen = { relayUrl: input.nodeRoad === false ? ownUrl : NODE_ROAD, apiKey: input.apiKey, ownUrl };
    return true;
}
/**
 * The own relay to try when a direct write failed, with the fetch that carries this account's key,
 * or null when this run did not choose the small roads (a named relay, or Mysten's).
 */
export function ownRelayFallback() {
    return chosen === null || chosen.relayUrl === chosen.ownUrl ? null : chosen.ownUrl;
}
/** Forget the choice (tests; a library caller between runs). */
export function resetUploadRoad() {
    chosen = null;
    companyRelay = null;
}
/** The road this run writes through: the storage nodes or the own relay when chosen, else the usual relay. */
export function uploadRelay(network) {
    return chosen?.relayUrl ?? companyRelay ?? relayHost(network);
}
/** The part size a fresh upload uses: unchanged on Mysten's road, at most 64 MiB on the small roads. */
export function partSizeForRoad(partSize) {
    return chosen === null ? partSize : Math.min(partSize, OWN_RELAY_PART_BYTES);
}
const wait = (ms, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted)
        return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(signal.reason);
    }, { once: true });
});
export function relayFetch(relayUrl, inner, sleep = wait) {
    const road = chosen;
    if (road === null || road.ownUrl !== relayUrl)
        return inner;
    return async (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set("authorization", `Bearer ${road.apiKey}`);
        for (;;) {
            const res = await inner(input, { ...init, headers });
            const after = res.headers.get("retry-after");
            if (res.status !== 503 || after === null)
                return res;
            const seconds = Number(after);
            await sleep(Math.max(1, Number.isFinite(seconds) ? seconds : 15) * 1000, init?.signal);
        }
    };
}
