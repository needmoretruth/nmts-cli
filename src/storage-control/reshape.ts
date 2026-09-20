// Cutting a storage resource, joining two of them, and handing one over — decided, priced, signed
// and handed back rather than printed.
//
// ⛔ ONE IMPLEMENTATION, TWO CALLERS, which is the whole reason this file exists. `nmts wallet
//    storage split|merge|transfer` is a terminal's shape: it prints a review, asks for `--yes` and
//    answers an exit code. The SDK is somebody else's program and needs the same acts with none of
//    those. A second implementation of "what may be joined with what" would be a second place for
//    the contract's rules to be got right, and the copy nobody re-reads is the one that quietly
//    disagrees — about transactions that spend a fee and cannot be undone.
//
// ⛔ THE ORDER IS THE SAFETY, and it is here rather than in either caller: ① the resources are READ
//    from the chain and the named ones must be this wallet's ② the browser's rules judge the request
//    and say why not ③ the exact transaction is dry-run for its fee, and a refusal there ends the
//    run ④ the review is handed out ⑤ `dryRun` stops here ⑥ `agree` is the gate — whatever it throws
//    stops the run with nothing signed ⑦ only then the signature.
//
// ⛔ HANDING ONE OVER MOVES NO FILE. What goes is size and remaining time; a file's bytes are sealed
//    with keys the NMTS key derives and stay unreadable to whoever receives the resource. It cannot
//    be undone and NMTS cannot recall it.
//
// ⚠ NOTHING HERE WRITES TO A STREAM, ASKS ANYBODY ANYTHING OR PICKS AN EXIT CODE, and nothing
//   reaches for `node:` — the chain and the signature are loaded only when no seam was supplied.

import { NmtsError } from "../errors.ts";
import type { Network } from "../network.ts";
import type { StorageResource } from "../shared/lib/storage-control/chain.ts";
import { canFuse } from "../shared/lib/storage-control/plan.ts";
import { isValidSuiAddress } from "../shared/lib/wallet/send-rules.ts";
import type { StorageOpShape, StorageOpsReads } from "../storage-control-chain.ts";
import type { WalletAction } from "../wallet-grant.ts";
import type { SignStorageOp } from "../wallet-sign-seams.ts";
import type { StorageHints } from "./hints.ts";
import { formatBytes, readOrRefuse } from "./list.ts";

/** The three things that can be done to a resource the wallet holds free. */
export type StorageOp = "split" | "merge" | "transfer";

/**
 * One request, in the values it is made of rather than in what anybody typed.
 *
 * ⚠ `keepEpochs` IS A COUNT AND THE CHAIN TAKES AN EPOCH. The resource keeps its first
 *   `keepEpochs` epochs; which absolute epoch that is depends on where it starts, which is a fact
 *   read from the chain below rather than one a caller should have to work out.
 */
export type StorageOpAsk =
  | { kind: "splitSize"; objectId: string; keepBytes: number }
  | { kind: "splitEpochs"; objectId: string; keepEpochs: number }
  | { kind: "merge"; first: string; second: string }
  | { kind: "transfer"; objectId: string; to: string };

/** A resource as the chain would hold it. A resource that does not exist yet has no id. */
export interface StorageShape {
  sizeBytes: number;
  startEpoch: number;
  endEpoch: number;
}

/** What one change leaves behind — the numbers, without a word of prose about them. */
export type StorageOpResult =
  | { kind: "split"; keeps: StorageShape; creates: StorageShape }
  | { kind: "merge"; becomes: StorageShape; consumed: string; how: "amount" | "periods" }
  | { kind: "transfer"; moves: StorageShape; to: string };

/** One request, judged: what the chain is asked for, what it needs, and what it would leave. */
export interface StorageOpPlan {
  op: StorageOp;
  /** The transaction shape — what is priced, and what is signed. One builder for both. */
  shape: StorageOpShape;
  /** The wallet unlock this needs: `reshape` for cutting and joining, `give` for handing over. */
  action: WalletAction;
  /** The resources it is about, as the chain has them. */
  named: readonly StorageResource[];
  result: StorageOpResult;
}

/** Why two resources cannot be joined, in the contract's own terms. */
const FUSE_WHY = {
  same: "those are the same resource.",
  differentSize: "their periods differ and so do their sizes — the contract joins sizes only over an identical period, and periods only at an identical size.",
  differentPeriod: "their periods differ.",
  notAdjacent: "their sizes are equal but their periods do not touch — one has to end where the other starts.",
} as const;

/**
 * Judge one request against the resources this wallet actually holds.
 *
 * ⛔ EVERY REFUSAL HAPPENS HERE, BEFORE THE CHAIN IS ASKED ANYTHING. Letting the contract refuse it
 *    instead leaves somebody having paid gas with no idea why — the rule the browser's own
 *    judgement (`shared/lib/storage-control/plan.ts`) was written for.
 */
export function planStorageOp(
  held: readonly StorageResource[],
  ask: StorageOpAsk,
  hints: StorageHints = {},
): StorageOpPlan {
  const one = (id: string): StorageResource => {
    const found = held.find((r) => r.objectId === id);
    if (found === undefined) {
      throw new NmtsError(`This wallet holds no free storage resource ${id}.`, {
        exitCode: 4,
        nextStep:
          hints.notHeld ??
          "Nothing was signed. A storage listing shows the free ones it holds; a resource bound " +
            "inside a file is not free.",
      });
    }
    return found;
  };
  // ⛔ THE JUDGEMENT IS HERE AND THE WORD FOR IT IS THE CALLER'S. What was too big has a different
  //    name at a prompt and in a program, and neither should be told about the other's.
  const tooBig = (what: "size" | "period", limit: string): NmtsError =>
    hints.cut?.(what, limit) ??
    new NmtsError(
      what === "size"
        ? `A cut by size keeps above 0 and below the resource's ${limit}.`
        : `A cut by period keeps a whole number of epochs above 0 and below the resource's ${limit}.`,
      { exitCode: 2, nextStep: "Nothing was signed. The rest becomes a second resource, so there has to be a rest." },
    );
  const shapeOf = (r: StorageResource): StorageShape => ({
    sizeBytes: r.sizeBytes,
    startEpoch: r.startEpoch,
    endEpoch: r.endEpoch,
  });

  if (ask.kind === "splitSize") {
    const r = one(ask.objectId);
    if (ask.keepBytes <= 0 || ask.keepBytes >= r.sizeBytes) throw tooBig("size", formatBytes(r.sizeBytes));
    return {
      op: "split",
      shape: { kind: "splitSize", objectId: ask.objectId, keepBytes: ask.keepBytes },
      action: "reshape",
      named: [r],
      result: {
        kind: "split",
        keeps: { ...shapeOf(r), sizeBytes: ask.keepBytes },
        creates: { ...shapeOf(r), sizeBytes: r.sizeBytes - ask.keepBytes },
      },
    };
  }

  if (ask.kind === "splitEpochs") {
    const r = one(ask.objectId);
    const span = r.endEpoch - r.startEpoch;
    if (!Number.isSafeInteger(ask.keepEpochs) || ask.keepEpochs <= 0 || ask.keepEpochs >= span) {
      throw tooBig("period", String(span));
    }
    const at = r.startEpoch + ask.keepEpochs;
    return {
      op: "split",
      shape: { kind: "splitEpoch", objectId: ask.objectId, splitEpoch: at },
      action: "reshape",
      named: [r],
      result: {
        kind: "split",
        keeps: { ...shapeOf(r), endEpoch: at },
        creates: { ...shapeOf(r), startEpoch: at },
      },
    };
  }

  if (ask.kind === "merge") {
    const first = one(ask.first);
    const second = one(ask.second);
    const verdict = canFuse(first, second);
    if (!verdict.can) {
      throw new NmtsError(`These two cannot be joined: ${FUSE_WHY[verdict.why]}`, {
        exitCode: 4,
        nextStep: "Nothing was signed. A storage listing shows each one's size and period.",
      });
    }
    return {
      op: "merge",
      shape: { kind: "fuse", first: ask.first, second: ask.second, how: verdict.kind },
      action: "reshape",
      named: [first, second],
      result: {
        kind: "merge",
        how: verdict.kind,
        consumed: ask.second,
        becomes:
          verdict.kind === "amount"
            ? { ...shapeOf(first), sizeBytes: first.sizeBytes + second.sizeBytes }
            : {
                sizeBytes: first.sizeBytes,
                startEpoch: Math.min(first.startEpoch, second.startEpoch),
                endEpoch: Math.max(first.endEpoch, second.endEpoch),
              },
      },
    };
  }

  const r = one(ask.objectId);
  // ⛔ THE ADDRESS IS JUDGED BEFORE THE CHAIN IS ASKED. A resource sent to a mistyped address is
  //    gone: nothing here, and nobody at NMTS, can recall it.
  if (!isValidSuiAddress(ask.to)) {
    throw new NmtsError("That is not a Sui address: it is 0x followed by 64 hexadecimal characters.", {
      exitCode: 2,
      nextStep: "Nothing was signed. Check the address it should go to.",
    });
  }
  return {
    op: "transfer",
    shape: { kind: "transfer", objectId: ask.objectId, to: ask.to },
    action: "give",
    named: [r],
    result: { kind: "transfer", moves: shapeOf(r), to: ask.to },
  };
}

/** What one change would do, priced, before anything is signed. */
export interface StorageOpReview {
  plan: StorageOpPlan;
  /** The wallet whose resources these are — the one that would sign. */
  address: string;
  network: Network;
  currentEpoch: number | null;
  /**
   * The chain fee the dry run measured, in MIST — or null when it could not be measured.
   * ⛔ NEVER ZERO FOR "UNKNOWN": the fee is charged with the signature either way.
   */
  feeMist: bigint | null;
}

/** Stopped at the review, or done and signed. */
export type ReshapeOutcome =
  | { kind: "review"; review: StorageOpReview }
  | { kind: "done"; review: StorageOpReview; digest: string };

/** Whose resources these are: the wallet that holds them, and the key that derives it. */
export interface ReshapeContext {
  network: Network;
  /** ⛔ The NMTS key. It never leaves this process: it derives the wallet and nothing else. */
  code: string;
  /** Which of this key's wallets holds the resources. */
  wallet: number;
  /** That wallet's address — read, priced and signed with as one. */
  address: string;
}

/** The chain, the signature, and the two places a caller gets a word in. ⚠ Seams, not options. */
export interface ReshapeSeams {
  reads?: ((network: Network) => StorageOpsReads) | undefined;
  /** ⛔ SEPARATE FROM THE READS so a test can prove the review stops before this. */
  sign?: SignStorageOp | undefined;
  /** Told once the change is priced, and before anything is signed. */
  onReview?: ((review: StorageOpReview) => void) | undefined;
  /** ⛔ THE GATE. Throwing here stops the run with nothing signed. */
  agree?: ((review: StorageOpReview) => void) | undefined;
  /** Stop at the review. Nothing is signed and no signer is even loaded. */
  dryRun?: boolean | undefined;
  /** What this caller wants said in a refusal instead of the neutral sentence. */
  hints?: StorageHints | undefined;
}

/** Read, judge, price and — unless somebody stops it — sign one change to a storage resource. */
export async function reshapeStorage(
  context: ReshapeContext,
  ask: StorageOpAsk,
  seams: ReshapeSeams = {},
): Promise<ReshapeOutcome> {
  const reads =
    seams.reads === undefined
      ? (await import("../storage-control-chain.ts")).storageOpsReads(context.network)
      : seams.reads(context.network);

  // ① The resources, and which epoch it is.
  const read = await readOrRefuse(() => reads.readStorage(context.address), seams.hints ?? {});
  // ② The request, judged.
  const plan = planStorageOp(read.items, ask, seams.hints ?? {});
  const walrusPackageId = await reads.walrusPackageId();
  // ③ The dry run: the fee, or the contract's own refusal.
  const verdict = await reads.dryRun(plan.shape, context.address);
  if (verdict.refusal !== null) {
    throw new NmtsError(`The chain would refuse this: ${verdict.refusal}`, {
      exitCode: 4,
      nextStep: "Nothing was signed and no fee was spent.",
    });
  }

  // ④ The review.
  const review: StorageOpReview = {
    plan,
    address: context.address,
    network: context.network,
    currentEpoch: read.currentEpoch,
    feeMist: verdict.feeMist,
  };
  seams.onReview?.(review);
  // ⑤ Stopped here, with nothing signed.
  if (seams.dryRun === true) return { kind: "review", review };
  // ⑥ The gate.
  seams.agree?.(review);

  // ⑦ The signature.
  const sign = seams.sign ?? (await import("../wallet-sign.ts")).signStorageOp;
  const digest = await sign({
    network: context.network,
    code: context.code,
    wallet: context.wallet,
    shape: plan.shape,
    walrusPackageId,
  });
  return { kind: "done", review, digest };
}
