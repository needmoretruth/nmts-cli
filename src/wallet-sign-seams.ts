// The shapes the signing module is reached through — one per thing this tool can sign.
//
// ⛔ THEY ARE SEAMS BECAUSE A TEST MUST BE ABLE TO PROVE THAT NOTHING SIGNED. Every command that
//    spends prints a review first and stops there without `--yes`; handing it a function that
//    fails the test if it is ever called is the only way to hold that promise, and a signature
//    that reached a chain in a test would cost money every time the suite ran.
//
// ⛔ EACH ONE CARRIES **WHICH WALLET** WHERE THE MONEY COMES FROM IT (2026-09-16). One
//    NMTS key opens a wallet at every index and the account says which one pays (`activeWallet`
//    in the sealed file list); the command resolves that number BEFORE it prices anything, so the
//    address in the review is the address that signs. A seam that let the number be omitted would
//    let a review be printed for one wallet and a transaction signed by another.
//
// ⚠ They moved out of `wallet-sign.ts` on 2026-09-16 — that file is what signs, and it has a
//   ceiling. Re-exported from there, so no caller spells a new path.

import type { StorageOpShape } from "./storage-control-chain.ts";
import type { SwapShape } from "./wallet-swap-chain.ts";
import type { TransferShape } from "./wallet-send-chain.ts";
import type { RegisterShape } from "./upload-wallet-plan.ts";
import type { Certificate } from "./upload-wire.ts";
import type { Network } from "./network.ts";

/** The seam `commands/wallet-hall.ts` signs through. Returns the base64 signature, nothing else. */
export type SignMessage = (input: {
  /** ⛔ The NMTS key. It never leaves this machine: it derives the wallet and nothing else. */
  code: string;
  /**
   * Which of this key's wallets proves the name.
   *
   * ⛔ IT IS THE PAYING WALLET BECAUSE THAT IS THE WALLET THE GIFT CAME FROM. A hall entry is an
   *    address, and `wallet donate` sends from the account's own number; signing with any other
   *    wallet would offer the server a name for an address that has never given anything.
   */
  wallet: number;
  message: string;
}) => Promise<string>;
/** The seam `commands/wallet-send.ts` signs through. Returns the transaction digest. */
export type SignTransfer = (input: {
  network: string;
  /** ⛔ The NMTS key. It never leaves this machine: it derives the wallet and nothing else. */
  code: string;
  /** Which of this key's wallets pays — the account's own number (`wallet-pay-index.ts`). */
  wallet: number;
  shape: TransferShape;
}) => Promise<string>;
/** The seam `commands/wallet-swap.ts` signs through. Returns the transaction digest. */
export type SignSwap = (input: {
  network: Network;
  /** ⛔ The NMTS key. It never leaves this machine: it derives the wallet and nothing else. */
  code: string;
  /** Which of this key's wallets swaps — the account's own number (`wallet-pay-index.ts`). */
  wallet: number;
  shape: SwapShape;
}) => Promise<string>;
/** The seam the wallet rail registers through. */
export type SignBlobRegister = (
  input: { network: Network; code: string; wallet: number; relayUrl: string } & RegisterShape,
) => Promise<{ digest: string; blobObjectId: string; endEpoch: number }>;
/** The seam the wallet rail certifies through. Returns the transaction digest. */
export type SignBlobCertify = (input: {
  network: Network;
  code: string;
  /** The same wallet that registered the part — it is the one that owns the blob object. */
  wallet: number;
  relayUrl: string;
  blobId: string;
  blobObjectId: string;
  certificate: Certificate;
}) => Promise<string>;
/** How a storage-resource operation is signed; the shape carries what the review priced. */
export type SignStorageOp = (input: {
  network: Network;
  code: string;
  /** Which of this key's wallets holds the resource — the account's own number. */
  wallet: number;
  shape: StorageOpShape;
  walrusPackageId: string;
}) => Promise<string>;
