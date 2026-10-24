// The chain reads behind `nmts extend`: what a lease says, how far ahead the network sells, and
// what more epochs cost.
//
// ⛔ EVERYTHING HERE IS A READ. Nothing in this file builds a transaction, holds a key or moves an
//    asset — the signature lives next door in `wallet-sign.ts`, alone, so that the file which can
//    spend is the smallest one in this tool. What is shared is the client builder below, because
//    the two must talk to the same chain: a quote read from one network and a payment made on
//    another is a payment for nothing.
//
// ⛔ SPLIT FROM THE COMMAND SO THE COMMAND CAN BE TESTED. `extend-plan.ts` decides what an
//    extension buys and `commands/extend.ts` decides what to say about it; both are driven by
//    `node --test` against fakes. A test that needed a live storage network could not run offline,
//    would answer differently every fortnight, and could never be asked to fail on demand.
//
// ⛔ AND NOTHING IS DEFAULTED TO ZERO. A lease that cannot be read, a shape the Move struct does
//    not have, a price the system object will not give — each throws with its reason. A cost of
//    zero on a screen that asks for money is the one wrong answer nobody would question.

import { ObjectError } from "@mysten/sui/client";
import { walrus } from "@mysten/walrus";

import { NmtsError } from "./errors.ts";
import { epochClock } from "./expiry.ts";
import type { BlobLease, ExtendReads, ExtendWindow } from "./extend-plan.ts";
import { dryRun, objectFields } from "./shared/lib/wallet/chain-calls.ts";
import { epochStartedMs } from "./walrus-write.ts";
import { storageNodesThrough } from "./walrus.ts";
import { freshWalrus } from "./walrus-fresh.ts";
import { suiClient } from "./sui-rpc.ts";
import { readBalances, walCoinType, type WalletBalances } from "./wallet.ts";
import { chainReader } from "./wallet-chain.ts";
import { Transaction } from "@mysten/sui/transactions";

/** How long one chain question gets. A read that stalls is a read that failed. */
export const EXTEND_READ_TIMEOUT_MS = 20_000;

/**
 * A Walrus-aware client for one network.
 *
 * ⛔ THE NETWORK NAME REACHES THE SDK AS WELL AS THE URL, exactly as it does for an upload. A
 *    mirror pointed at the wrong chain would otherwise be discovered as a refusal from the storage
 *    contract — after a transaction had been signed.
 */
export function walrusClient(network: string): ReturnType<typeof build> {
  return build(network);
}

function build(network: string) {
  return suiClient(network === "mainnet" ? "mainnet" : "testnet").$extend(walrus(storageNodesThrough()));
}

/** A number off the wire, whether it arrived as a number or as one of Sui's 64-bit strings. */
function numberOf(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * One blob's lease, read from the Blob object itself.
 *
 * ⛔ NARROWED FROM `unknown`. The node renders the Move struct as JSON (gRPC and GraphQL alike —
 *    measured on mainnet 2026-10-21: `size` a string, `storage.end_epoch` a number), and nothing about
 *    that rendering is promised by a type the compiler could check, so every field is read with a test.
 */
export async function readBlobLease(
  client: ReturnType<typeof build>,
  objectId: string,
): Promise<BlobLease> {
  let fields: Record<string, unknown> | null;
  try {
    fields = await objectFields(client, objectId);
  } catch (error) {
    // Only the node's own "no such object" is said as one; a node that did not answer is thrown
    // as itself, because "deleted" and "unreachable" ask the person to do different things.
    if (!(error instanceof ObjectError)) throw error;
    fields = null;
  }
  if (fields === null) {
    throw new NmtsError(`The storage object ${objectId} could not be read from the chain.`, {
      exitCode: 1,
      nextStep:
        "Nothing was signed and nothing was charged. The blob may already have been deleted, or " +
        "this tool may be pointed at the wrong network — `nmts env` says which one it is using.",
    });
  }
  const storage: unknown = fields["storage"];
  const size = numberOf(fields["size"]);
  const endEpoch = numberOf(
    typeof storage === "object" && storage !== null && "end_epoch" in storage ? storage.end_epoch : undefined,
  );
  if (size === null || endEpoch === null) {
    // ⛔ A shape change in the Move struct surfaces HERE, not as a wrong price downstream.
    throw new NmtsError(`The storage object ${objectId} is not shaped the way this version reads.`, {
      exitCode: 1,
      nextStep: "Nothing was signed and nothing was charged. Update this tool.",
    });
  }
  return { objectId, size, endEpoch };
}

/**
 * The reads one `nmts extend` run needs, bound to one network.
 *
 * ⚠ THE WINDOW IS `null` RATHER THAN A GUESS when the network cannot be read, exactly as it is for
 *   `nmts expiring`: the caller stops. An unread clock and a file in no danger look identical from
 *   outside and are the opposite of each other.
 */
export function extendReads(network: string): ExtendReads {
  const client = build(network);
  return {
    async readWindow(): Promise<ExtendWindow | null> {
      try {
        const [system, staking] = await Promise.all([
          client.walrus.systemState(),
          client.walrus.stakingState(),
        ]);
        const clock = epochClock(
          Number(system.committee.epoch),
          Number(staking.epoch_duration),
          epochStartedMs(staking.epoch_state),
        );
        if (clock === null) return null;
        // How far ahead a lease may reach: the protocol's future-accounting ring length, which is
        // exactly what `storage_accounting::max_epochs_ahead` returns. Read, never assumed — it
        // is the difference between offering a length the network will sell and one it refuses
        // on-chain after the transaction is signed.
        const maxAhead = numberOf(system.future_accounting.length);
        if (maxAhead === null || maxAhead <= 0) return null;
        return { clock, maxAhead };
      } catch {
        return null;
      }
    },

    readLeases(objectIds: readonly string[]): Promise<BlobLease[]> {
      return Promise.all(objectIds.map((id) => readBlobLease(client, id)));
    },

    /**
     * What extending every one of these blobs by `epochs` costs, in FROST (WAL base units).
     *
     * ⭐ STORAGE ONLY. Extending pays for space over time; the write cost was paid once when the
     *    blob was registered and is not charged again. That is why extending is markedly cheaper
     *    than uploading the same bytes afresh, and why `totalCost` is the wrong field here.
     */
    async quote(leases: readonly BlobLease[], epochs: number): Promise<bigint> {
      if (epochs <= 0 || leases.length === 0) return 0n;
      const fresh = freshWalrus(client);
      const costs = await Promise.all(leases.map((lease) => fresh.storageCost(lease.size, epochs)));
      return costs.reduce((sum, cost) => sum + BigInt(cost.storageCost), 0n);
    },
    async readWallet(address: string): Promise<WalletBalances> {
      const net = network === "mainnet" ? "mainnet" : "testnet";
      return readBalances(chainReader(net, address), walCoinType(net));
    },
    async estimateGas({ sender, objectIds, epochs }): Promise<bigint | null> {
      // ⛔ THE SAME TRANSACTION `wallet-sign.ts` SIGNS — sender, de-duplicated ids, one fragment per
      //    blob — so the fee measured is the fee of what would actually be approved. A different
      //    shape here would print a number no transaction ever pays.
      try {
        const tx = new Transaction();
        tx.setSender(sender);
        const fresh = freshWalrus(client);
        for (const blobObjectId of [...new Set(objectIds)]) {
          tx.add(fresh.extendBlob({ blobObjectId, epochs }));
        }
        const bytes = await tx.build({ client });
        const { status, gasUsed } = await dryRun(client, bytes);
        if (!status.success) return null;
        return netGasFee(gasUsed);
      } catch {
        // Not a number, and not zero: "could not measure" is a different fact from "free".
        return null;
      }
    },
  };
}

/**
 * What a transaction actually costs in MIST: computation plus storage, less the rebate for storage
 * it freed. Clamped at zero — a rebate can exceed the rest and the chain does not pay the sender.
 * The browser app's `netGasFeeBaseUnits` is the same arithmetic.
 */
export function netGasFee(gasUsed: { computationCost: string; storageCost: string; storageRebate: string }): bigint {
  const fee = BigInt(gasUsed.computationCost) + BigInt(gasUsed.storageCost) - BigInt(gasUsed.storageRebate);
  return fee > 0n ? fee : 0n;
}
