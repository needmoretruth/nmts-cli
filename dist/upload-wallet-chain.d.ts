import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";
import type { Network } from "./network.ts";
import type { RegisterShape, WalletUploadReads } from "./upload-wallet-plan.ts";
import type { Certificate } from "./upload-wire.ts";
/**
 * The most this tool will pay an upload relay as a tip, in MIST, per network.
 *
 * ⚠ A SECOND COPY of the browser's `RELAY_TIP_MAX_MIST`, for the same reason `WAL_COIN_TYPES` is:
 *   this package imports nothing from that tree. It is a CEILING, not the charge — the relay's own
 *   tip configuration sets the amount, which the review prints — and a relay asking for more than
 *   this is refused by the SDK before anything is signed.
 */
export declare const RELAY_TIP_CEILING_MIST: Readonly<Record<Network, number>>;
/** The Walrus package addresses of one network. Exported from the SDK; the system object survives upgrades. */
export declare function packageConfig(network: Network): {
    systemObjectId: string;
};
declare function build(network: Network, relayUrl: string): import("@mysten/sui/client").ClientWithExtensions<{
    walrus: import("@mysten/walrus").WalrusClient;
}, SuiJsonRpcClient>;
export type PayingClient = ReturnType<typeof build>;
/** A Walrus client bound to ONE relay, able to pay that relay's tip. */
export declare function payingClient(network: Network, relayUrl: string): PayingClient;
/**
 * The register transaction of ONE part — the tip, then either a purchase or a held resource.
 *
 * ⛔ SENDER FIRST. `coinWithBalance` and the SDK's own coin selection pick WAL and SUI from the
 *    sender's address when the fragments resolve; without it the build fails late.
 */
export declare function registerTransaction(client: PayingClient, network: Network, input: RegisterShape & {
    sender: string;
}): Promise<Transaction>;
/** The certify transaction of ONE part, from the certificate the relay handed back. */
export declare function certifyTransaction(client: PayingClient, input: {
    blobId: string;
    blobObjectId: string;
    certificate: Certificate;
}): Transaction;
/**
 * The blob object a register transaction created, and when its storage ends.
 *
 * ⛔ THE OBJECT IS FOUND BY ITS TYPE, not by position: the transaction also creates the leftover
 *    resource on a cut, and on a purchase the storage object is created and consumed inside it.
 */
export declare function createdBlob(client: PayingClient, objectChanges: unknown): Promise<{
    blobObjectId: string;
    endEpoch: number;
}>;
/** What this part is once the network has encoded it — the number registration compares a resource against. */
export declare function encodedLength(client: PayingClient, sender: string, sealedLen: number): Promise<number>;
/** The live reads one wallet-paid upload needs, bound to one network and one relay. */
export declare function walletUploadReads(network: Network, relayUrl: string): WalletUploadReads;
export {};
