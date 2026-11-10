// The direct write's stop rule (D51, 2026-11-10): once a quorum of storage nodes has confirmed,
//   wait a little for the rest, then stop. Shared byte for byte with the command line
//   (`deploy/gen-cli-shared.mjs` copies it to `cli/src/shared/lib/walrus/`).
//
// ⛔ WHY. The SDK's `writeEncodedBlobToNodes` waits for EVERY node to answer or time out
//    (`Promise.all`). One slow or silent node therefore holds the whole upload until its request
//    timeout, and the node road's timeout is long on purpose (a slow line must finish). Measured on
//    testnet from a browser, 10 MiB, 2026-11-10: 80 % of the 1,521 sliver writes were in by 8 s and the
//    quorum by about 7 s, but the last node answered at 66 s and five silent ones were cut at 135 s, so
//    the upload took 229 s. The certificate needs a quorum, not every node; the nodes that missed the
//    write recover their slivers from the others (Walrus's own sync), which is what the network is for.
// ⛔ THE GRACE. After the quorum, the write waits as long again as the quorum took (2 s to 20 s), so a
//    healthy network still gets nearly every confirmation and a straggler cannot hold the upload. Walrus's
//    own client waits a time proportional to the time to quorum for the same reason.
// ⛔ WHAT COUNTS AS QUORUM. The chain's rule and nothing else: the confirming nodes' shards, weighed by
//    `bls_aggregate::is_quorum` (3 * weight >= 2 * n_shards + 1). Until 11-10 this also waited for more
//    than two thirds of the NODES, because the SDK's certificate counts nodes; that count waited for
//    confirmations the chain does not need and failed testnet writes at 63 of 97 nodes. The certificate
//    is now built by the same shard rule (node-certificate.ts).
// ⛔ A NODE WHOSE WRITE FAILED IS ASKED AGAIN, ALONE. Measured on testnet, 2026-11-10: 14 of 97 nodes
//    answered NOT_REGISTERED to the metadata for longer than the SDK's three tries a second apart, and
//    with 28 nodes not answering at all the rest fell short of the 65 a certificate needs. The SDK gives
//    a node one try; a failed node is asked again 3, 6, 12 and 24 s later while the write is open, and
//    the SDK's own metadata check then sends it only the slivers it lacks. Before, a few lost nodes
//    failed the whole write and the upload sent every node everything again (80 MiB: 17,383 PUTs in a
//    run with dead nodes, 4,569 in one whose first write went through; the gap is read as whole rewrites).
// ⛔ THE STALL LIMIT. A node that never answers is held by its request timeout, which is long on purpose
//    (the whole encoded part on a slow line: 50 minutes for a 32 MiB part). One run sat for 25 minutes
//    with no quorum and too few failures to give up. Once more than half the shards have confirmed, the
//    write ends when no node has settled for four times as long as that took (at least 90 s): certified
//    when the quorum is there, otherwise "Too many failures". A write that still moves is never cut.
import type { WalrusClient } from "@mysten/walrus";
import { chainQuorum } from "./node-certificate.ts";

type WriteAll = WalrusClient["writeEncodedBlobToNodes"];
type Options = Parameters<WriteAll>[0];
type Confirmation = Awaited<ReturnType<WriteAll>>[number];
type Writer = Pick<WalrusClient, "writeEncodedBlobToNode" | "systemState"> & { writeEncodedBlobToNodes: WriteAll };

export const QUORUM_GRACE_MIN_MS = 2_000;
export const QUORUM_GRACE_MAX_MS = 20_000;
export const STALL_FLOOR_MS = 90_000;
export const RETRY_WAITS_MS: readonly number[] = [3_000, 6_000, 12_000, 24_000];

export interface QuorumTiming {
  now?: () => number;
  stallFloorMs?: number;
  retryWaitsMs?: readonly number[];
}

/** So many shards lost that the rest can never reach the chain's quorum. */
const beyondHope = (lostShards: number, nShards: number): boolean => !chainQuorum(nShards - lostShards, nShards);

/** Wait `ms`, or less when the signal aborts. */
const pause = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

/** Replace the client's all-nodes wait with quorum-then-grace. Returns the same client. */
export function stopAtQuorum<T extends Writer>(walrus: T, timing: QuorumTiming = {}): T {
  const now = timing.now ?? Date.now;
  const stallFloorMs = timing.stallFloorMs ?? STALL_FLOOR_MS;
  const waits = timing.retryWaitsMs ?? RETRY_WAITS_MS;
  /** One node's write, asked again after a failure while the write is open. */
  const writeOne = async (input: Parameters<Writer["writeEncodedBlobToNode"]>[0], signal: AbortSignal): Promise<Confirmation> => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await walrus.writeEncodedBlobToNode(input);
      } catch (error) {
        const wait = waits[attempt];
        if (wait === undefined || signal.aborted) throw error;
        await pause(wait, signal);
        if (signal.aborted) throw error;
      }
    }
  };
  const writeAll: WriteAll = async ({ blobId, metadata, sliversByNode, signal, ...options }: Options) => {
    const { committee } = await walrus.systemState();
    const nShards = committee.n_shards;
    const nNodes = sliversByNode.length;
    const controller = new AbortController();
    const linked = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
    const results: Confirmation[] = sliversByNode.map(() => null);
    const started = now();
    let okShards = 0;
    let lostShards = 0;
    let settled = 0;

    return await new Promise<Confirmation[]>((resolve, reject) => {
      let graceTimer: ReturnType<typeof setTimeout> | null = null;
      let stallTimer: ReturnType<typeof setTimeout> | null = null;
      let stallMs: number | null = null;
      let done = false;
      const tooMany = (why: string) => new Error(`Too many failures while writing blob ${blobId} to nodes (${why})`);
      const quorum = (): boolean => chainQuorum(okShards, nShards);
      const finish = (error?: Error): void => {
        if (done) return;
        done = true;
        if (graceTimer !== null) clearTimeout(graceTimer);
        if (stallTimer !== null) clearTimeout(stallTimer);
        controller.abort(error ?? new Error("quorum reached; the remaining node writes were stopped"));
        if (error) reject(error);
        else resolve([...results]);
      };
      const check = (): void => {
        if (settled === nNodes) return finish(quorum() ? undefined : tooMany("no quorum"));
        if (graceTimer === null && quorum()) {
          const grace = Math.min(Math.max(now() - started, QUORUM_GRACE_MIN_MS), QUORUM_GRACE_MAX_MS);
          graceTimer = setTimeout(() => finish(), grace);
        }
        if (stallMs === null && okShards * 2 > nShards) stallMs = Math.max((now() - started) * 4, stallFloorMs);
        if (stallMs !== null) {
          if (stallTimer !== null) clearTimeout(stallTimer);
          stallTimer = setTimeout(() => finish(quorum() ? undefined : tooMany(`${nNodes - settled} nodes did not answer`)), stallMs);
        }
      };
      sliversByNode.forEach((slivers, nodeIndex) => {
        const shards = slivers.primary.length;
        writeOne({ blobId, nodeIndex, metadata, slivers, signal: linked, ...options }, linked)
          .then(
            (confirmation) => {
              results[nodeIndex] = confirmation;
              okShards += shards;
            },
            () => {
              lostShards += shards;
            },
          )
          .finally(() => {
            settled += 1;
            if (done) return;
            if (beyondHope(lostShards, nShards)) return finish(tooMany("refused"));
            check();
          });
      });
    });
  };
  walrus.writeEncodedBlobToNodes = writeAll;
  return walrus;
}
