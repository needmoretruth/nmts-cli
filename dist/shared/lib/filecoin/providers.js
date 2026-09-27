// The Filecoin storage companies NMTS Heavy may place a file with, per Filecoin chain.
//
// ⚠ THIS FILE IS PUBLISHED. It is copied byte-for-byte into the `nmts` command-line package, so
//   its comments stay self-contained English and it imports nothing.
//
// WHY A FIXED LIST AND NOT "EVERY APPROVED COMPANY ON CHAIN". A browser may only talk to hosts its
//   Content-Security-Policy names, and the policy is written at build time. Accepting whatever the
//   chain approves at the moment of an upload would mean opening the policy to any host at all. So
//   the candidates are this list; adding one is a code change and a release. The chain's own
//   approved set still applies on top: a company here that the chain no longer approves is skipped.
//
// HOW A PAIR IS CHOSEN (the server does it, from this same list): the first copy goes to an
//   endorsed company, the second to a company run by a DIFFERENT operator, so that one operator
//   failing never takes both copies. `operator` exists only to make that comparison.
//
// ⛔ THE SERVER KEEPS AN IDENTICAL TABLE. Both sides must agree on every row, or the server places a
//    copy with a company the browser is not allowed to read from. A test compares the two files.
//
// Recorded 2026-09-23 on Filecoin Calibration: approved providers 2, 4 and 9; endorsed 4 and 9;
// 2 and 9 are run by the same operator.
// Recorded 2026-09-26 on Filecoin mainnet: approved providers 1, 5, 7, 32, 36 and 37; endorsed 1, 5,
// 7 and 32; 1 and 32 are run by one operator, 36 and 37 by another. Every one answers the browser's
// cross-origin upload and read requests. A company that stops answering is skipped when a pair is
// chosen, not removed from this list.
/** The allowlist, per chain, in preference order. */
export const FILECOIN_PROVIDERS = {
    calibration: [
        { id: 4n, host: "caliberation-pdp.infrafolio.com", operator: "infrafolio", endorsed: true },
        { id: 9n, host: "calib.ezpdpz.net", operator: "ezpdpz", endorsed: true },
        { id: 2n, host: "calib2.ezpdpz.net", operator: "ezpdpz", endorsed: false },
    ],
    mainnet: [
        { id: 1n, host: "main.ezpdpz.net", operator: "ezpdpz", endorsed: true },
        { id: 5n, host: "pdp.lotus.dedyn.io", operator: "mongo2stor", endorsed: true },
        { id: 7n, host: "mainnet-pdp.infrafolio.com", operator: "infrafolio", endorsed: true },
        { id: 32n, host: "main2.ezpdpz.net", operator: "ezpdpz", endorsed: true },
        { id: 36n, host: "cello.fidl.tech", operator: "fidl", endorsed: false },
        { id: 37n, host: "bass.fidl.tech", operator: "fidl", endorsed: false },
    ],
};
/**
 * Which Filecoin chain goes with which NMTS network: test data stays on test networks.
 *
 * Keyed by the NMTS network name ("testnet" | "mainnet") so that this file needs no import.
 */
export const FILECOIN_CHAIN_FOR_NETWORK = {
    testnet: "calibration",
    mainnet: "mainnet",
};
/** The `https://<host>` origins of one chain's list, in order. */
export function filecoinProviderOrigins(chain) {
    return FILECOIN_PROVIDERS[chain].map((p) => `https://${p.host}`);
}
/** The allowlisted company serving `host` on `chain`, or `null` when the host is not on the list. */
export function providerForHost(chain, host) {
    const wanted = host.toLowerCase();
    return FILECOIN_PROVIDERS[chain].find((p) => p.host === wanted) ?? null;
}
