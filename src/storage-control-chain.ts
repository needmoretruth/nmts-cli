// The chain behind `nmts wallet storage split|merge|transfer`: one builder per shape, the dry run
// that prices it and says whether the contract would take it, and the package to call.
//
// ⛔ ONE BUILDER FOR THE FEE AND THE SIGNATURE — the rule `wallet-send-chain.ts` keeps. What the
//    review priced is what `wallet-sign.ts` signs.
//
// ⛔ THE CALLS ARE WRITTEN BY HAND, as `shared/lib/storage-control/reuse.ts` writes `split_by_size`:
//    the SDK exports the `Storage` struct and no function wrappers, and its generated bindings are
//    not on an exported path. The signatures are the contract's (`storage_resource.move`):
//      · `split_by_size(&mut Storage, u64)  → Storage`  self keeps `split_size`; the rest is returned
//      · `split_by_epoch(&mut Storage, u32) → Storage`  self keeps [start, split); [split, end) is returned
//      · `fuse_amount(&mut Storage, Storage)`            same period; the second's size joins the first
//      · `fuse_periods(&mut Storage, Storage)`           same size, adjacent periods; the second is consumed
//    ⛔ A returned resource must be transferred or the transaction is refused at assembly for an
//       unused value; a consumed one needs nothing. The dry run is the final judge of every rule.

import { Transaction } from "@mysten/sui/transactions";

import { walrusClient, netGasFee } from "./extend-chain.ts";
import type { Network } from "./network.ts";
import type { StorageRead } from "./commands/wallet-storage.ts";
import { splitStorageToFit } from "./shared/lib/storage-control/reuse.ts";

export type StorageOpShape =
  | { kind: "splitSize"; objectId: string; keepBytes: number }
  | { kind: "splitEpoch"; objectId: string; splitEpoch: number }
  | { kind: "fuse"; first: string; second: string; how: "amount" | "periods" }
  | { kind: "transfer"; objectId: string; to: string };

/** The transaction one shape is, for `sender`. */
export function storageOpTransaction(
  shape: StorageOpShape,
  input: { walrusPackageId: string; sender: string },
): Transaction {
  const tx = new Transaction();
  tx.setSender(input.sender);
  switch (shape.kind) {
    case "splitSize":
      return splitStorageToFit(
        { walrusPackageId: input.walrusPackageId, storageObjectId: shape.objectId, keepBytes: shape.keepBytes, owner: input.sender },
        tx,
      );
    case "splitEpoch": {
      const later = tx.moveCall({
        package: input.walrusPackageId,
        module: "storage_resource",
        function: "split_by_epoch",
        arguments: [tx.object(shape.objectId), tx.pure.u32(shape.splitEpoch)],
      });
      tx.transferObjects([later], input.sender);
      return tx;
    }
    case "fuse":
      tx.moveCall({
        package: input.walrusPackageId,
        module: "storage_resource",
        function: shape.how === "amount" ? "fuse_amount" : "fuse_periods",
        arguments: [tx.object(shape.first), tx.object(shape.second)],
      });
      return tx;
    case "transfer":
      tx.transferObjects([tx.object(shape.objectId)], shape.to);
      return tx;
  }
}

/** What the dry run said: a fee, or the chain's own reason for refusing. */
export interface DryRunVerdict {
  feeMist: bigint | null;
  refusal: string | null;
}

/** What the command reads before it prints a review, and the seam a test replaces. */
export interface StorageOpsReads {
  readStorage(address: string): Promise<StorageRead>;
  walrusPackageId(): Promise<string>;
  dryRun(shape: StorageOpShape, sender: string): Promise<DryRunVerdict>;
}

export function storageOpsReads(network: Network): StorageOpsReads {
  const client = walrusClient(network);
  return {
    async readStorage(address) {
      return (await import("./wallet-storage-chain.ts")).readWalletStorage(network, address);
    },
    async walrusPackageId() {
      return (await client.walrus.systemObject()).package_id;
    },
    async dryRun(shape, sender) {
      try {
        const walrusPackageId = await this.walrusPackageId();
        const bytes = await storageOpTransaction(shape, { walrusPackageId, sender }).build({ client });
        const { effects } = await client.dryRunTransactionBlock({ transactionBlock: bytes });
        if (effects.status.status !== "success") {
          return { feeMist: null, refusal: effects.status.error ?? "the chain gave no reason" };
        }
        return { feeMist: netGasFee(effects.gasUsed), refusal: null };
      } catch (error) {
        // ⚠ A refusal at ASSEMBLY (a wrong argument, an object that is not this wallet's) is an
        //   answer the person needs; a node that did not answer is not, and is said as unmeasured.
        const message = error instanceof Error ? error.message : String(error);
        return /abort|MoveAbort|InsufficientGas|ObjectNotFound|IncorrectUserSignature|not owned/i.test(message)
          ? { feeMist: null, refusal: message }
          : { feeMist: null, refusal: null };
      }
    },
  };
}
