import { chainQuorum } from "./node-certificate.js";
export const QUORUM_GRACE_MIN_MS = 2_000;
export const QUORUM_GRACE_MAX_MS = 20_000;
export const STALL_FLOOR_MS = 90_000;
export const RETRY_WAITS_MS = [3_000, 6_000, 12_000, 24_000];
/** So many shards lost that the rest can never reach the chain's quorum. */
const beyondHope = (lostShards, nShards) => !chainQuorum(nShards - lostShards, nShards);
/** Wait `ms`, or less when the signal aborts. */
const pause = (ms, signal) => new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
});
/** Replace the client's all-nodes wait with quorum-then-grace. Returns the same client. */
export function stopAtQuorum(walrus, timing = {}) {
    const now = timing.now ?? Date.now;
    const stallFloorMs = timing.stallFloorMs ?? STALL_FLOOR_MS;
    const waits = timing.retryWaitsMs ?? RETRY_WAITS_MS;
    /** One node's write, asked again after a failure while the write is open. */
    const writeOne = async (input, signal) => {
        for (let attempt = 0;; attempt++) {
            try {
                return await walrus.writeEncodedBlobToNode(input);
            }
            catch (error) {
                const wait = waits[attempt];
                if (wait === undefined || signal.aborted)
                    throw error;
                await pause(wait, signal);
                if (signal.aborted)
                    throw error;
            }
        }
    };
    const writeAll = async ({ blobId, metadata, sliversByNode, signal, ...options }) => {
        const { committee } = await walrus.systemState();
        const nShards = committee.n_shards;
        const nNodes = sliversByNode.length;
        const controller = new AbortController();
        const linked = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
        const results = sliversByNode.map(() => null);
        const started = now();
        let okShards = 0;
        let lostShards = 0;
        let settled = 0;
        return await new Promise((resolve, reject) => {
            let graceTimer = null;
            let stallTimer = null;
            let stallMs = null;
            let done = false;
            const tooMany = (why) => new Error(`Too many failures while writing blob ${blobId} to nodes (${why})`);
            const quorum = () => chainQuorum(okShards, nShards);
            const finish = (error) => {
                if (done)
                    return;
                done = true;
                if (graceTimer !== null)
                    clearTimeout(graceTimer);
                if (stallTimer !== null)
                    clearTimeout(stallTimer);
                controller.abort(error ?? new Error("quorum reached. The remaining node writes were stopped"));
                if (error)
                    reject(error);
                else
                    resolve([...results]);
            };
            const check = () => {
                if (settled === nNodes)
                    return finish(quorum() ? undefined : tooMany("no quorum"));
                if (graceTimer === null && quorum()) {
                    const grace = Math.min(Math.max(now() - started, QUORUM_GRACE_MIN_MS), QUORUM_GRACE_MAX_MS);
                    graceTimer = setTimeout(() => finish(), grace);
                }
                if (stallMs === null && okShards * 2 > nShards)
                    stallMs = Math.max((now() - started) * 4, stallFloorMs);
                if (stallMs !== null) {
                    if (stallTimer !== null)
                        clearTimeout(stallTimer);
                    stallTimer = setTimeout(() => finish(quorum() ? undefined : tooMany(`${nNodes - settled} nodes did not answer`)), stallMs);
                }
            };
            sliversByNode.forEach((slivers, nodeIndex) => {
                const shards = slivers.primary.length;
                writeOne({ blobId, nodeIndex, metadata, slivers, signal: linked, ...options }, linked)
                    .then((confirmation) => {
                    results[nodeIndex] = confirmation;
                    okShards += shards;
                }, () => {
                    lostShards += shards;
                })
                    .finally(() => {
                    settled += 1;
                    if (done)
                        return;
                    if (beyondHope(lostShards, nShards))
                        return finish(tooMany("refused"));
                    check();
                });
            });
        });
    };
    walrus.writeEncodedBlobToNodes = writeAll;
    return walrus;
}
