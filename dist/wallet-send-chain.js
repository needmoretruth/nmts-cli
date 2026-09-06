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
import { walrusClient, netGasFee } from "./extend-chain.js";
import { readBalances, walCoinType } from "./wallet.js";
import { chainReader } from "./wallet-chain.js";
export function transferTransaction(input) {
    const tx = new Transaction();
    tx.setSender(input.sender);
    if (input.coin === "SUI") {
        const [sui] = tx.splitCoins(tx.gas, [input.amountBaseUnits]);
        tx.transferObjects([sui], input.destination);
    }
    else {
        const wal = tx.add(coinWithBalance({ balance: input.amountBaseUnits, type: input.walType }));
        tx.transferObjects([wal], input.destination);
    }
    if (input.gasBudgetMist !== undefined)
        tx.setGasBudget(input.gasBudgetMist);
    return tx;
}
export function sendReads(network) {
    const client = walrusClient(network);
    return {
        async readWallet(address) {
            return readBalances(chainReader(network, address), walCoinType(network));
        },
        async estimateFee(shape, sender) {
            try {
                const bytes = await transferTransaction({ ...shape, sender }).build({ client });
                const { effects } = await client.dryRunTransactionBlock({ transactionBlock: bytes });
                if (effects.status.status !== "success")
                    return null;
                return netGasFee(effects.gasUsed);
            }
            catch {
                return null;
            }
        },
    };
}
