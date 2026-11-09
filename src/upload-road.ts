/**
 * NMTS's own upload relay — the second road for uploads from this tool (D50, 2026-11-09).
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
import { reachFetch } from "./reach.ts";
import { RELAY_HOSTS, relayHost } from "./walrus.ts";

/** Where the own relay answers, after the NMTS server's address. */
export const OWN_RELAY_PATH = "/v1/relay";

/** The part size on the own road: an existing preset, the size whose relay peak fits the server. */
export const OWN_RELAY_PART_BYTES = 64 * 2 ** 20;

/** How long Mysten's relay gets to answer before this run takes the own road. */
export const ROAD_PROBE_TIMEOUT_MS = 10_000;

interface Road {
  relayUrl: string;
  apiKey: string;
}

let chosen: Road | null = null;

/** True for the own relay's address on any NMTS server. */
export function isOwnRelay(relayUrl: string): boolean {
  return relayUrl.replace(/\/+$/, "").endsWith(OWN_RELAY_PATH);
}

/**
 * Decide this run's road, once, before anything is priced. True when the own road was taken.
 *
 * `probe` is the request that asks Mysten's relay (tests pass a fake one).
 */
export async function chooseUploadRoad(input: {
  network: string;
  server: string;
  apiKey: string;
  probe?: typeof fetch;
  timeoutMs?: number;
}): Promise<boolean> {
  chosen = null;
  const known = RELAY_HOSTS[input.network]?.[0];
  // A caller or an environment that named a relay chose it; nothing is asked.
  if (known === undefined || relayHost(input.network) !== known) return false;
  const probe = input.probe ?? reachFetch;
  try {
    const res = await probe(`${known}/v1/tip-config`, {
      signal: AbortSignal.timeout(input.timeoutMs ?? ROAD_PROBE_TIMEOUT_MS),
    });
    if (res.ok) return false;
  } catch {
    // No answer: the own road below.
  }
  chosen = { relayUrl: `${input.server.replace(/\/+$/, "")}${OWN_RELAY_PATH}`, apiKey: input.apiKey };
  return true;
}

/** Forget the choice (tests; a library caller between runs). */
export function resetUploadRoad(): void {
  chosen = null;
}

/** The relay this run writes through: the own one when it was chosen, else the usual one. */
export function uploadRelay(network: string): string {
  return chosen?.relayUrl ?? relayHost(network);
}

/** The part size a fresh upload uses: unchanged on Mysten's road, at most 64 MiB on ours. */
export function partSizeForRoad(partSize: number): number {
  return chosen === null ? partSize : Math.min(partSize, OWN_RELAY_PART_BYTES);
}

const wait = (ms: number, signal?: AbortSignal | null): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });

/**
 * The fetch the relay client uses. On the own road it carries this account's key, and while another
 * upload holds the relay (503 with `Retry-After`) it waits and asks again until the SDK's own
 * timeout ends it. On Mysten's road it is `inner` unchanged.
 */
export type RelayFetch = (input: RequestInfo, init?: RequestInit) => Promise<Response>;

export function relayFetch(
  relayUrl: string,
  inner: RelayFetch,
  sleep: (ms: number, signal?: AbortSignal | null) => Promise<void> = wait,
): RelayFetch {
  const road = chosen;
  if (road === null || road.relayUrl !== relayUrl) return inner;
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${road.apiKey}`);
    for (;;) {
      const res = await inner(input, { ...init, headers });
      const after = res.headers.get("retry-after");
      if (res.status !== 503 || after === null) return res;
      const seconds = Number(after);
      await sleep(Math.max(1, Number.isFinite(seconds) ? seconds : 15) * 1000, init?.signal);
    }
  };
}
