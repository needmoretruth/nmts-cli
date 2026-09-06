// The transfer transaction and its live reads: the wallet's balances and the fee a dry run measures.
//
// ⛔ ONE BUILDER FOR THE FEE AND THE SIGNATURE. `estimateTransferFee` and `wallet-sign.ts` both call
//    `transferTransaction`, so the fee printed is the fee of the transaction that is then signed. Two
//    builders would let a screen price one transaction and approve another.
//
// ⛔ THE TWO COINS MOVE DIFFERENTLY, and the difference is not cosmetic: SUI is split off the gas
//    coin the transaction is already paying with; WAL is a separate coin type gathered from the
//    wallet's own WAL coins, and the gas is still SUI. The browser's `withdrawFromEmbedded` does the
//    same two things.

import { coinWithBalance, Transaction } from "@mysten/sui/transactions";

import { walrusClient, netGasFee } from "./extend-chain.ts";
import type { Network } from "./network.ts";
import type { SendCoin } from "./shared/lib/wallet/send-rules.ts";
import { readBalances, walCoinType, type WalletBalances } from "./wallet.ts";
import { chainReader } from "./wallet-chain.ts";

export interface TransferShape {
  coin: SendCoin;
  amountBaseUnits: bigint;
  /** A full, validated Sui address. */
  destination: string;
  /** The WAL coin type of the network (unused for SUI). */
  walType: string;
  /** A gas ceiling, or undefined to let the SDK set one from its own dry run. */
  gasBudgetMist?: bigint | undefined;
}

export function transferTransaction(input: TransferShape & { sender: string }): Transaction {
  const tx = new Transaction();
  tx.setSender(input.sender);
  if (input.coin === "SUI") {
    const [sui] = tx.splitCoins(tx.gas, [input.amountBaseUnits]);
    tx.transferObjects([sui], input.destination);
  } else {
    const wal = tx.add(coinWithBalance({ balance: input.amountBaseUnits, type: input.walType }));
    tx.transferObjects([wal], input.destination);
  }
  if (input.gasBudgetMist !== undefined) tx.setGasBudget(input.gasBudgetMist);
  return tx;
}

/** What `commands/wallet-send.ts` reads before it prints a review. */
export interface SendReads {
  readWallet(address: string): Promise<WalletBalances>;
  /** The fee in MIST measured by dry-running this exact transfer, or null when it could not be. */
  estimateFee(shape: TransferShape, sender: string): Promise<bigint | null>;
}

export function sendReads(network: Network): SendReads {
  const client = walrusClient(network);
  return {
    async readWallet(address) {
      return readBalances(chainReader(network, address), walCoinType(network));
    },
    async estimateFee(shape, sender) {
      try {
        const bytes = await transferTransaction({ ...shape, sender }).build({ client });
        const { effects } = await client.dryRunTransactionBlock({ transactionBlock: bytes });
        if (effects.status.status !== "success") return null;
        return netGasFee(effects.gasUsed);
      } catch {
        return null;
      }
    },
  };
}
