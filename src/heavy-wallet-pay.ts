// NMTS Heavy paid in WAL from one of this key's Sui wallets: the order opened first so its price can
// be read, the wallet's balances held against that price, and the WAL sent only once every part is
// stored.
//
// ⛔ SHARED BY THIS TOOL AND THE SDK. What differs between them — a person reading the price under a
//    standing wallet agreement, or a program whose call is the agreement — is three hooks, so the
//    order in which money can move is written once.
//
// ⛔ THE PRICE SIGNED IS THE PRICE QUOTED. The order is opened once under one idempotency key and the
//    run reopens it under the same key; a price that changed between the two is a refusal, not a
//    signature.
//
// ⛔ A KNOWN SHORTFALL STOPS THE RUN BEFORE ANYTHING IS SEALED. An order the wallet cannot pay leaves
//    storage companies holding bytes nobody pays for, and counts against the day's unpaid orders.

import { NmtsError } from "./errors.ts";
import { createHeavyApi } from "./heavy-api.ts";
import { HEAVY_COPY } from "./heavy-copy.ts";
import { heavyOrderPut, planHeavyFile, type HeavyFile, type HeavyOrderContext, type HeavyOrderOutcome } from "./heavy-upload.ts";
import type { Network } from "./network.ts";
import { heavyOrderRequest, type HeavyPayment } from "./shared/lib/heavy/order-runner.ts";
import { coinAmount, walCoinType, walletAddress } from "./wallet.ts";
import type { SendReads, TransferShape } from "./wallet-send-chain.ts";

/** What the opened order asks, and what the paying wallet holds against it. */
export interface HeavyWalletQuote {
  orderId: string;
  /** The Sui address that sends the WAL. */
  address: string;
  /** Where the WAL goes. */
  treasury: string;
  walFrost: bigint;
  /** The transfer's measured fee in MIST, or null when it could not be measured. */
  feeMist: bigint | null;
  termDays: number;
}

export interface HeavyWalletInput {
  code: string;
  network: Network;
  /** Which of this key's wallets pays. */
  wallet: number;
  /** 1..=365. */
  termDays: number;
  /** Told the quote as soon as it is known — before the checks, so a refusal follows what was shown. */
  onQuote?: ((quote: HeavyWalletQuote) => void) | undefined;
  /** Asked once the balances cover the quote, before anything is sealed; throwing stops the run. */
  approve?: ((quote: HeavyWalletQuote) => void) | undefined;
  /** Told once the WAL has left. */
  onPaid?: ((spent: { walFrost: bigint; suiMist: bigint }) => void) | undefined;
  /** ⚠ Seams, not options: the chain's reads and the transfer's signature, for tests. */
  reads?: SendReads | undefined;
  sign?: ((shape: TransferShape) => Promise<string>) | undefined;
}

/** Store `files` in one wallet-paid Heavy order. */
export async function heavyWalletPut(
  ctx: HeavyOrderContext,
  files: readonly HeavyFile[],
  input: HeavyWalletInput,
): Promise<HeavyOrderOutcome & { quote: HeavyWalletQuote }> {
  const address = await walletAddress(input.code, input.wallet);
  const idempotencyKey = ctx.idempotencyKey ?? globalThis.crypto.randomUUID();
  const plans = files.map((f, index) => ({
    key: `f${index}`,
    parts: planHeavyFile(f.source.size, ctx.rule).map((p) => ({ partIndex: p.partIndex, sealedLen: p.sealedLen })),
  }));
  const shapeOf = (walFrost: bigint, treasury: string): TransferShape => ({
    coin: "WAL",
    amountBaseUnits: walFrost,
    destination: treasury,
    walType: walCoinType(input.network),
  });
  let quote: HeavyWalletQuote | null = null;
  const payment: HeavyPayment = {
    pay: "wallet",
    payer: address,
    termDays: input.termDays,
    payWallet: async (price) => {
      const amount = BigInt(price.wal_frost);
      if (quote === null || amount !== quote.walFrost || price.treasury !== quote.treasury) {
        throw new NmtsError(HEAVY_COPY.failed("payment_refused", `${amount} ≠ ${quote?.walFrost ?? "?"}`));
      }
      const digest = await (input.sign ?? ((shape) => signWith(input, shape)))(shapeOf(amount, price.treasury));
      input.onPaid?.({ walFrost: amount, suiMist: quote.feeMist ?? 0n });
      return digest;
    },
  };
  const created = await (ctx.api ?? createHeavyApi(ctx.server, ctx.bearer)).createOrder(heavyOrderRequest(plans, payment, idempotencyKey));
  const price = created.price;
  if (price === undefined) throw new NmtsError(HEAVY_COPY.failed("bad_answer", "no price"));
  const walFrost = BigInt(price.wal_frost);
  const reads = input.reads ?? (await import("./wallet-send-chain.ts")).sendReads(input.network);
  const [purse, feeMist] = await Promise.all([reads.readWallet(address), reads.estimateFee(shapeOf(walFrost, price.treasury), address)]);
  quote = { orderId: created.order_id, address, treasury: price.treasury, walFrost, feeMist, termDays: input.termDays };
  input.onQuote?.(quote);
  if (!purse.sui.read || !purse.wal.read) {
    throw new NmtsError("A balance could not be read, so this tool cannot tell what can be sent.", { exitCode: 1 });
  }
  if (purse.wal.baseUnits < walFrost || purse.sui.baseUnits < (feeMist ?? 0n)) {
    throw new NmtsError(
      HEAVY_COPY.walletShort(coinAmount(walFrost), coinAmount(purse.wal.baseUnits), coinAmount(feeMist ?? 0n), coinAmount(purse.sui.baseUnits)),
      { exitCode: 4 },
    );
  }
  input.approve?.(quote);
  const outcome = await heavyOrderPut({ ...ctx, idempotencyKey }, files, payment);
  return { ...outcome, quote };
}

/** The signing module is loaded only when WAL is about to move. */
async function signWith(input: HeavyWalletInput, shape: TransferShape): Promise<string> {
  const { signTransfer } = await import("./wallet-sign.ts");
  return signTransfer({ network: input.network, code: input.code, wallet: input.wallet, shape });
}
