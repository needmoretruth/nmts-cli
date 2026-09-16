// A WALLET-PAID upload with no terminal in it: one file sealed here, its storage bought by the
// wallet the NMTS key derives instead of by credits, the sealed bytes pushed, the file named in
// the account's sealed list.
//
// ⛔ WHY THIS IS NOT IN `commands/`. Paying for storage from somebody's own coins existed only as
//    `nmts put --pay wallet`, and a command cannot be called from a library: it parses arguments,
//    prints, asks a person and exits. Everything below takes its inputs as values and reports
//    through a return value and thrown `NmtsError`s, which is what lets the SDK — and somebody's
//    own server — pay for an upload from their own coins without inheriting a terminal.
//
// ⛔ IT PRICES BEFORE IT SIGNS, ALWAYS, in the order `extend` set: the parts are planned, the chain
//    quotes each part in WAL and the relay's tip in SUI, the register transaction is dry-run for
//    its fee, both balances are read — and only then is `onReview` told the numbers, a known
//    shortfall refused, and `agree` given its say. A dry run stops at the review and never loads
//    the signing module.
//
// ⛔ `agree` IS THE ONE GATE BETWEEN A PROGRAM AND SOMEBODY'S WALLET, and it is a parameter
//    because who may say yes differs: the command holds the review against this machine's wallet
//    agreement, and a library call IS the agreement, made by the caller who wrote the call.
//    Everything before it is a read.
//
// ⛔ THE SERVER IS TOLD THE STORAGE IS THE PERSON'S BY SAYING NOTHING ELSE. `POST /v1/items` forces
//    treasury ownership only on a part that names a certified reservation; a wallet-paid part names
//    none and carries the blob object and the end epoch instead, exactly as the browser's own
//    wallet-paid commit does (`upload-steps.ts`).
//
// ⛔ A HELD RESOURCE IS OFFERED, NEVER CHOSEN FOR THE CALLER — the owner's rule for storage
//    resources. Without `storage` this buys new storage and the review counts the free resources
//    the wallet holds; with it the review says in bytes what is cut free or bound with the file.
//
// ⚠ NO SPENDING LEDGER AND NO GIFT LIVE HERE. Both are the command's: the ledger counts what one
//   machine signed under one agreement, and a standing gift is a choice a person made in their own
//   account. A library that kept either would be deciding for a caller who never asked it to.

import type { OnCollision } from "./collision.ts";
import { DERIVED, type CryptoGlue } from "./crypto.ts";
import { NmtsError } from "./errors.ts";
import { setTrashed } from "./item-trash.ts";
import { addEntry } from "./manifest-write.ts";
import type { Network } from "./network.ts";
import { sealedLenFor } from "./seal.ts";
import type { PaddingRule } from "./shared/lib/crypto/size-padding.ts";
import { statusOf } from "./shared/lib/storage-control/plan.ts";
import { createUploadApi } from "./upload-api.ts";
import { partKeysOf, uploadFile, type FileUploadStep, type PlaintextSource } from "./upload-file.ts";
import { CREDIT_BYTES, planAndPrice } from "./upload-price.ts";
import { clearItemRecord, clearReservation } from "./upload-store.ts";
import { walletRail } from "./upload-wallet.ts";
import {
  chooseUploadEpochs,
  daysOf,
  parseStorageAsk,
  pickResource,
  uploadBudget,
  uploadShortfallNextStep,
  type StorageChoice,
  type UploadBudget,
  type WalletUploadReads,
} from "./upload-wallet-plan.ts";
import type { BlobProtocol, UploadApi } from "./upload-wire.ts";
import { walletAddress } from "./wallet.ts";
import type { Spend } from "./wallet-grant.ts";
import type { SignBlobCertify, SignBlobRegister } from "./wallet-sign.ts";
import { createBlobProtocol } from "./walrus-write.ts";

/** The account this upload belongs to, and how it seals. */
export interface WalletPutContext {
  /** ⛔ The NMTS key. It seals the file AND derives the wallet that pays. It is never written down. */
  code: string;
  apiKey: string;
  server: string;
  network: Network;
  accountId: string;
  crypt: CryptoGlue;
  /** How much of the file goes into one part. */
  partSize: number;
  /** The rounding rule from the account's sealed list — it changes the stored size, so the price. */
  rule: PaddingRule;
  /** What to do about a name already in use. Absent = the machine's setting, as `addEntry` reads it. */
  onCollision?: OnCollision | undefined;
  /**
   * Which of this key's wallets pays, by index (0 = the first one).
   *
   * ⛔ THE CALLER RESOLVES IT, BEFORE ANYTHING IS PRICED. It is the account's own number, kept in
   *    the sealed file list (`wallet-pay-index.ts`), and a library that guessed at it here would
   *    price one address and sign with another.
   */
  wallet: number;
}

/** One file and where it goes — already resolved, because a library resolves nothing by asking. */
export interface WalletPutFile {
  source: PlaintextSource;
  name: string;
  parentId: string | null;
  /** The destination AS TYPED — part of the reservation key, so both runs of a resume agree. */
  destination: string;
}

/** The chain, the signatures, the wire and the four things a caller may be told. */
export interface WalletPutSeams {
  /** How many of the storage network's epochs to buy. Default `DEFAULT_UPLOAD_EPOCHS`. */
  epochs?: string | number | undefined;
  /** `fit`, `whole`, or a held resource's object id. Absent = buy new storage. */
  storage?: string | undefined;
  /** Stop at the review. Nothing is sealed, signed or sent, and no signer is even loaded. */
  dryRun?: boolean | undefined;
  /** ⚠ A SEAM, NOT AN OPTION — what the chain is asked. */
  readChain?: ((network: Network, relayUrl: string) => WalletUploadReads | Promise<WalletUploadReads>) | undefined;
  /** ⛔ SEPARATE FROM THE READS so a caller can prove the review stops before this. */
  sign?: { register: SignBlobRegister; certify: SignBlobCertify } | undefined;
  /** ⚠ SEAMS, NOT OPTIONS — the storage-network protocol and the server calls. */
  protocol?:
    | ((network: Network, bodyBytes: number, onSent: (sent: number, total: number) => void) => BlobProtocol & { relayUrl: string })
    | undefined;
  api?: UploadApi | undefined;
  /** Told as sealed bytes leave for the relay. */
  onProgress?: ((sent: number, total: number) => void) | undefined;
  /** Told about each step as it starts. */
  onStep?: ((step: FileUploadStep) => void) | undefined;
  /** Told the numbers the moment they are known — before the dry run returns and before a refusal. */
  onReview?: ((review: WalletPutReview) => void) | undefined;
  /** ⛔ THE GATE. Throwing here stops the upload with nothing signed. See the module header. */
  agree?: ((review: WalletPutReview) => void) | undefined;
  /** Told what left the wallet, after each signature. */
  onSpend?: ((spend: Spend) => void) | undefined;
}

/** What this upload would buy, in the order somebody deciding needs it. Base units throughout. */
export interface WalletPutReview {
  name: string;
  /** Plaintext bytes. */
  bytes: number;
  /** Bytes the storage network holds, padding and sealing included. */
  sealedBytes: number;
  parts: number;
  epochs: number;
  /** The term in days, read from the network's own clock. */
  days: string;
  /** The epoch the storage runs to. */
  endEpoch: number;
  /** The relay's tip over every part, in MIST. Paid inside the register signatures. */
  tipMist: bigint;
  /** Where the storage comes from. */
  storage: StorageChoice;
  /** Free storage resources the wallet holds when none was asked for; null when unreadable. */
  heldResources: number | null;
  /** The wallet against the price: what is needed, what is held, and the shortfall if there is one. */
  budget: UploadBudget;
}

/** A dry run's answer, or a finished upload's. The review is in both, so both report one price. */
export type WalletPutOutcome =
  | { kind: "review"; review: WalletPutReview }
  | {
      kind: "uploaded";
      review: WalletPutReview;
      itemId: string;
      /** The name it got — numbered if the one asked for was taken. */
      savedAs: string;
      /** The id of the file this one displaced into the trash, when the machine overwrites. */
      replaced: string | null;
      /** The file-list version this write produced. */
      fileListVersion: number;
      /** True when every part was already signed for by an earlier run: this call spent nothing. */
      resumed: boolean;
    };

/**
 * Price, agree, sign, upload and record ONE file, paid from the wallet the NMTS key derives.
 *
 * ⛔ THE SIGNING MODULE IS LOADED ONLY AFTER `agree` HAS RETURNED. A dry run and a refusal never
 *    bring the code that can spend into memory.
 */
export async function walletPut(
  ctx: WalletPutContext,
  file: WalletPutFile,
  seams: WalletPutSeams = {},
): Promise<WalletPutOutcome> {
  const { plan, sealedBytes, sealFor } = planAndPrice(file.source.size, ctx.partSize, ctx.rule);
  const sealedLens = plan.map((range) => sealedLenFor(sealFor(range)));
  const storageAsk = parseStorageAsk(seams.storage);
  if (storageAsk !== null && plan.length > 1) {
    throw new NmtsError(`A held storage resource holds one blob, and this file is ${plan.length} parts.`, {
      exitCode: 4,
      nextStep: `Nothing was signed. Leave the storage resource off, or raise the part size so the file is one part.`,
    });
  }
  const protocol = (seams.protocol ?? createBlobProtocol)(ctx.network, sealedBytes, (sent, total) =>
    seams.onProgress?.(sent, total),
  );
  const reads = await (seams.readChain ?? defaultReads)(ctx.network, protocol.relayUrl);
  const window = await reads.readWindow();
  if (window === null) {
    throw new NmtsError(`The ${ctx.network} storage network could not be read.`, {
      exitCode: 1,
      nextStep: `Nothing was signed and nothing was sent. Which epoch the network is in, and how far ahead it will sell, are facts only the chain has — this will not spend against a guess.`,
    });
  }
  const epochs = chooseUploadEpochs(seams.epochs, window);
  const endEpoch = window.clock.current + epochs;
  const quotes = await reads.quoteParts(sealedLens, epochs);
  // ⛔ THE ADDRESS THAT IS PRICED IS THE ADDRESS THAT SIGNS — the same number the rail carries.
  const address = await walletAddress(ctx.code, ctx.wallet);

  let storage: StorageChoice = { kind: "buy" };
  let heldResources: number | null = null;
  if (storageAsk !== null) {
    const firstQuote = quotes[0];
    const firstLen = sealedLens[0];
    if (firstQuote === undefined || firstLen === undefined) throw new NmtsError("unreachable: a plan with no part");
    let resources;
    try {
      resources = await reads.readStorage(address);
    } catch (error) {
      throw new NmtsError("The storage resources this wallet holds could not be read.", {
        exitCode: 1,
        nextStep: `Nothing was signed. That is not the same as holding none. Cause: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
    const encoded = await reads.encodedLength(address, firstLen);
    storage = pickResource(storageAsk, resources, encoded, window.clock.current, endEpoch, firstQuote.writeFrost);
  } else {
    // ⚠ A read that fails is null, not zero: this number only offers a choice, and losing it must
    //   not lose the upload.
    heldResources = await reads.readStorage(address).then(
      (rows) => rows.filter((r) => statusOf(r, window.clock.current) === "usable").length,
      () => null,
    );
  }

  const [purse, feeMist] = await Promise.all([
    reads.readWallet(address),
    reads.estimateRegisterGas({
      sender: address,
      sealedLen: Math.max(...sealedLens),
      epochs,
      storage:
        storage.kind === "buy"
          ? storage
          : { kind: "reuse", objectId: storage.objectId, cutToBytes: storage.cutToBytes, writeFrost: storage.writeFrost },
    }),
  ]);
  const budget = uploadBudget({ address, purse, feeMist, quotes, storage });
  const review: WalletPutReview = {
    name: file.name,
    bytes: file.source.size,
    sealedBytes,
    parts: plan.length,
    epochs,
    days: daysOf(window, epochs),
    endEpoch,
    tipMist: quotes.reduce((sum, q) => sum + q.tipMist, 0n),
    storage,
    heldResources,
    budget,
  };
  seams.onReview?.(review);
  if (seams.dryRun === true) return { kind: "review", review };
  // ⛔ A WALLET KNOWN TO BE SHORT IS REFUSED BEFORE THE AGREEMENT IS ASKED FOR (`extend-budget.ts`).
  if (budget.shortfall !== null) {
    throw new NmtsError(budget.shortfall, { exitCode: 4, nextStep: uploadShortfallNextStep(budget) });
  }
  seams.agree?.(review);
  const sign = seams.sign ?? (await signers());
  const onSpend = seams.onSpend ?? ((): void => undefined);

  const derived = ctx.crypt.kdf_derive(ctx.crypt.account_code_parse(ctx.code));
  const dataKey = derived.slice(DERIVED.dataKey[0], DERIVED.dataKey[1]);
  derived.fill(0);
  let result;
  try {
    result = await uploadFile({
      api: seams.api ?? createUploadApi(ctx.server, ctx.apiKey),
      protocol,
      crypt: ctx.crypt,
      dataKey,
      source: file.source,
      name: file.name,
      parentId: file.parentId,
      destination: file.destination,
      relayUrl: protocol.relayUrl,
      epochs,
      currentEpoch: window.clock.current,
      partSize: ctx.partSize,
      padding: { rule: ctx.rule, unitBytes: CREDIT_BYTES },
      ...(seams.onStep === undefined ? {} : { onStep: seams.onStep }),
      buy: walletRail({
        network: ctx.network,
        code: ctx.code,
        wallet: ctx.wallet,
        relayUrl: protocol.relayUrl,
        epochs,
        storage,
        quotes,
        feeMist,
        signRegister: sign.register,
        signCertify: sign.certify,
        onSpend,
      }),
    });
  } finally {
    dataKey.fill(0);
  }
  const now = Date.now();
  // ⛔ FROM `result.entry`, NOT FROM THIS CALL. The key that opens the stored bytes is the key they
  //    were sealed with, which on a resume belongs to the call that sealed them.
  const added = await addEntry({
    server: ctx.server,
    apiKey: ctx.apiKey,
    code: ctx.code,
    accountId: ctx.accountId,
    ...(ctx.onCollision !== undefined ? { onCollision: ctx.onCollision } : {}),
    entry: {
      id: result.itemId,
      parentId: file.parentId,
      kind: 1,
      name: result.entry.name,
      size: result.entry.plaintextLen,
      createdAt: now,
      updatedAt: now,
      dekWrapped: result.entry.dekWrapped,
      contentHashCt: result.entry.contentHashCt,
    },
  });
  // ⛔ ONLY NOW, AND EVERY PART — the same order the credit rail keeps and for the same reason: a
  //    paid-for file the list does not name is invisible, and the records are what let a second
  //    call finish the job without signing again.
  clearItemRecord(result.fileKey);
  for (const record of partKeysOf(result.fileKey, result.parts)) clearReservation(record);
  if (added.replaced) await setTrashed(ctx.server, ctx.apiKey, added.replaced.id, true);
  return {
    kind: "uploaded",
    review,
    itemId: result.itemId,
    savedAs: added.name,
    replaced: added.replaced?.id ?? null,
    fileListVersion: added.seq,
    resumed: result.resumed,
  };
}

async function defaultReads(network: Network, relayUrl: string): Promise<WalletUploadReads> {
  return (await import("./upload-wallet-chain.ts")).walletUploadReads(network, relayUrl);
}

async function signers(): Promise<{ register: SignBlobRegister; certify: SignBlobCertify }> {
  const signing = await import("./wallet-sign.ts");
  return { register: signing.signBlobRegister, certify: signing.signBlobCertify };
}
