import { type WalrusClient } from "@mysten/walrus";
type CertArgs = Parameters<WalrusClient["certificateFromConfirmations"]>[0];
type Certificate = Awaited<ReturnType<WalrusClient["certificateFromConfirmations"]>>;
type SystemState = Awaited<ReturnType<WalrusClient["systemState"]>>;
type Member = SystemState["committee"]["members"][number];
/** The chain's quorum (`walrus::bls_aggregate::is_quorum`). */
export declare const chainQuorum: (weight: number, nShards: number) => boolean;
/** The message every confirming node signs for this blob in this epoch. */
export declare function confirmationMessage(epoch: number, blobId: string, deletable: boolean, blobObjectId: string): Uint8Array;
/**
 * Combine the confirmations whose message and signature hold into a certificate, or throw when their
 * shard weight is short of the chain's quorum. `members` is the BLS committee in signer-index order.
 */
export declare function certificateByShardWeight(confirmations: CertArgs["confirmations"], members: readonly Pick<Member, "public_key" | "weight">[], nShards: number, expected: Uint8Array): Certificate;
type Certifier = Pick<WalrusClient, "certificateFromConfirmations" | "systemState">;
/** Replace the client's node-count certificate with the chain's shard-weight one. */
export declare function certifyByShardWeight<T extends Certifier>(walrus: T): T;
export {};
