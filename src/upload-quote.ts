// What an upload of N bytes for E epochs costs, asked with no file, no account and no wallet.
//
// ⛔ WHY (spec 2026-09-20 Deponejo · gap C · plan 2026-11-10 §1.1). A business pricing an invoice
//    has to say "N bytes for E epochs is this much WAL, this much SUI, this many credits" before
//    its customer has a funded wallet — often before the customer has an account at all. Until now
//    the price came back only from `put(…, { dryRun: true })`, which needs the file and an opened
//    account. A business that had to call Walrus directly to price an invoice had a reason to build
//    on Walrus rather than on NMTS.
//
// ⛔ THE SAME ARITHMETIC AS THE UPLOAD, NOT A COPY. The part plan, the padding of the last part and
//    the sealed length come from `planAndPrice` — the function `put` prices with — and the WAL and
//    the relay's tip from `walletUploadReads().quoteParts`, the read `walletPut` makes. So the WAL
//    this answers for a sealed size is the WAL the upload's review answers for the same size.
//
// ⚠ THE GAS IS AN ESTIMATE AND SAYS SO. An upload measures its register fee by dry-running the exact
//   transaction with the payer's coins; with no payer there are no coins to dry-run with. The
//   estimate is the gas the two transactions used on testnet (`MEASURED_GAS` below, with the
//   digests it came from), its computation part scaled by the network's reference gas price read
//   now. The field is named `gasEstimateMist` and `gasSource` says where the number came from.
//
// ⚠ NOTHING HERE WRITES TO A STREAM OR REACHES FOR `node:`: the SDK's browser entry runs it.

import { normalizeSuiAddress } from "@mysten/sui/utils";

import { NmtsError } from "./errors.ts";
import type { ExtendWindow } from "./extend-plan.ts";
import type { Network } from "./network.ts";
import { DEFAULT_PART_BYTES, sealedLenFor } from "./seal.ts";
import type { PaddingRule } from "./shared/lib/crypto/size-padding.ts";
import { creditsFor, planAndPrice, UPLOAD_EPOCHS } from "./upload-price.ts";
import { chooseUploadEpochs, type PartQuote } from "./upload-wallet-plan.ts";

/**
 * The gas one part's two transactions used, measured on testnet (2026-11-10, this unit's runs).
 *
 * ⛔ COMPUTATION IS IN GAS UNITS, STORAGE IN MIST. Sui charges computation as units × the reference
 *    gas price, which each network sets per epoch, and storage at a fixed price per byte; the
 *    rebate is what deleting the objects later gives back. Keeping the units lets the estimate
 *    follow the network's price instead of freezing testnet's.
 */
export const MEASURED_GAS = {
  source:
    "measured on testnet 2026-11-10 from one sponsored upload of a 1 MiB file (register " +
    "8XLr5kR7n9pypv5PznrqhUtFc7QAK9k7HbHBts5aF3ds, certify E9JtBWV6ntyWQuaucrkGLrZDrF4JiQV2knFnwJzvLbAN); " +
    "computation scaled by the reference gas price read now",
  // Most of register's storage charge is the shared system object being rewritten, and most of it
  // comes back as the rebate in the same transaction: the net is about 3 million MIST.
  register: { computationUnits: 1_000n, storageMist: 115_732_800n, rebateMist: 112_757_523n },
  certify: { computationUnits: 1_000n, storageMist: 2_006_400n, rebateMist: 1_975_802n },
} as const;

/** What the quote asks for. */
export interface UploadQuoteAsk {
  /** The file's size in bytes, before sealing. */
  bytes: number;
  /** Storage-network epochs. Default 2, the term `put` buys. */
  epochs?: number | undefined;
  /** How the last part is padded. Default `padme`, a new account's rule. */
  padding?: PaddingRule | undefined;
  /** Bytes of the file per part. Default 64 MiB, `put`'s. */
  partSize?: number | undefined;
}

/** One part, priced. Base units throughout, as decimal strings so JSON carries them whole. */
export interface QuotedPart {
  /** Bytes the storage network holds for this part, sealing and padding included. */
  sealedBytes: number;
  /**
   * What the part occupies once the network has encoded it — the size a storage resource must
   * have to hold it (`buyStorage({ sizeBytes })`, `put(…, { storage: id })`). ⚠ Far above
   * `sealedBytes` for a small part: the encoding carries metadata for every shard.
   */
  encodedBytes: number;
  storageFrost: string;
  writeFrost: string;
  tipMist: string;
}

/** The answer. */
export interface UploadQuote {
  network: Network;
  bytes: number;
  epochs: number;
  /** The epoch the storage would end at if it were bought now. */
  endEpoch: number;
  parts: QuotedPart[];
  sealedBytes: number;
  /** The parts' encoded sizes added up: what one resource holding the whole upload must have. */
  encodedBytes: number;
  /** WAL for the storage and the write, in FROST. */
  walFrost: string;
  /** SUI for the relay's tip, in MIST. */
  tipMist: string;
  /** SUI for the chain fees of every part's two transactions, in MIST. ⚠ An estimate — see `gasSource`. */
  gasEstimateMist: string;
  /** Where `gasEstimateMist` came from. */
  gasSource: string;
  /** The relay the tip is for. Another relay charges its own tip; the storage nodes charge none. */
  relay: string;
  /**
   * What the same upload costs on the credit rail. ⛔ NULL WHEN `epochs` IS NOT THE CREDIT TERM:
   * a credit buys one mebibyte for exactly 2 epochs, and the credit rail sells no other term.
   */
  credits: number | null;
}

/** The chain, as the quote reads it. ⚠ A seam — a test hands in a table. */
export interface UploadQuoteReads {
  readWindow(): Promise<ExtendWindow | null>;
  quoteParts(sealedLens: readonly number[], epochs: number): Promise<PartQuote[]>;
  /** The network's reference gas price now, in MIST per unit, or null when it could not be read. */
  referenceGasPrice(): Promise<bigint | null>;
  /** What `sealedLen` bytes occupy once encoded — the chain's own function, asked with no sender. */
  encodedLength(sealedLen: number): Promise<number>;
}

/** The relay a quote is for and the reads behind it, for one network. */
async function defaultReads(network: Network): Promise<{ relay: string; reads: UploadQuoteReads }> {
  const [{ relayHost }, { walletUploadReads }, { suiClient }] = await Promise.all([
    import("./walrus.ts"),
    import("./upload-wallet-chain.ts"),
    import("./sui-rpc.ts"),
  ]);
  const relay = relayHost(network);
  const upload = walletUploadReads(network, relay);
  return {
    relay,
    reads: {
      readWindow: () => upload.readWindow(),
      quoteParts: (lens, epochs) => upload.quoteParts(lens, epochs),
      // ⚠ A READ WITH NO WALLET: the simulation runs with its checks off, so any sender will do.
      encodedLength: (sealedLen) => upload.encodedLength(normalizeSuiAddress("0x0"), sealedLen),
      async referenceGasPrice() {
        try {
          const { referenceGasPrice } = await suiClient(network).core.getReferenceGasPrice();
          return BigInt(referenceGasPrice);
        } catch {
          return null;
        }
      },
    },
  };
}

/** The measured gas of `parts` parts at `price` MIST per unit. */
export function gasEstimate(parts: number, price: bigint): bigint {
  const one = (g: { computationUnits: bigint; storageMist: bigint; rebateMist: bigint }): bigint =>
    g.computationUnits * price + g.storageMist - g.rebateMist;
  return BigInt(parts) * (one(MEASURED_GAS.register) + one(MEASURED_GAS.certify));
}

/** The price of an upload of `ask.bytes` for `ask.epochs`, with nothing opened and nothing signed. */
export async function quoteUpload(
  network: Network,
  ask: UploadQuoteAsk,
  seams: { reads?: UploadQuoteReads; relay?: string } = {},
): Promise<UploadQuote> {
  if (!Number.isSafeInteger(ask.bytes) || ask.bytes < 0) {
    throw new NmtsError(`A size is a whole number of bytes, 0 or more: ${String(ask.bytes)}.`, {
      exitCode: 2,
      nextStep: "Nothing was read from the chain. Pass the file's size in bytes.",
    });
  }
  const partSize = ask.partSize ?? DEFAULT_PART_BYTES;
  if (!Number.isSafeInteger(partSize) || partSize <= 0) {
    throw new NmtsError(`A part size is a positive whole number of bytes: ${String(ask.partSize)}.`, { exitCode: 2 });
  }
  const { plan, sealFor } = planAndPrice(ask.bytes, partSize, ask.padding ?? "padme");
  const sealedLens = plan.map((range) => sealedLenFor(sealFor(range)));
  const found = seams.reads === undefined ? await defaultReads(network) : { relay: seams.relay ?? "", reads: seams.reads };
  const window = await found.reads.readWindow();
  if (window === null) {
    throw new NmtsError(`The ${network} storage network could not be read.`, {
      exitCode: 1,
      nextStep: "Nothing was spent. Which epoch it is and how far ahead the network sells are facts only the chain has. Ask again.",
    });
  }
  // ⛔ THE SAME REFUSAL AS THE UPLOAD: a term the network will not sell is refused, never clamped.
  const epochs = chooseUploadEpochs(ask.epochs, window);
  const [quotes, price, encoded] = await Promise.all([
    found.reads.quoteParts(sealedLens, epochs),
    found.reads.referenceGasPrice(),
    Promise.all(sealedLens.map((len) => found.reads.encodedLength(len))),
  ]);
  if (price === null) {
    throw new NmtsError(`The ${network} reference gas price could not be read.`, {
      exitCode: 1,
      nextStep: "Nothing was spent. The fee estimate scales with that price, so it is not guessed. Ask again.",
    });
  }
  const sum = (pick: (q: PartQuote) => bigint): bigint => quotes.reduce((total, q) => total + pick(q), 0n);
  const sealedBytes = sealedLens.reduce((total, len) => total + len, 0);
  return {
    network,
    bytes: ask.bytes,
    epochs,
    endEpoch: window.clock.current + epochs,
    parts: quotes.map((q, i) => ({
      sealedBytes: q.sealedLen,
      encodedBytes: encoded[i] ?? 0,
      storageFrost: q.storageFrost.toString(),
      writeFrost: q.writeFrost.toString(),
      tipMist: q.tipMist.toString(),
    })),
    sealedBytes,
    encodedBytes: encoded.reduce((total, n) => total + n, 0),
    walFrost: sum((q) => q.storageFrost + q.writeFrost).toString(),
    tipMist: sum((q) => q.tipMist).toString(),
    gasEstimateMist: gasEstimate(quotes.length, price).toString(),
    gasSource: MEASURED_GAS.source,
    relay: found.relay,
    credits: epochs === UPLOAD_EPOCHS ? sealedLens.reduce((total, len) => total + creditsFor(len), 0) : null,
  };
}

