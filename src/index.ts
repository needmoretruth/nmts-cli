// The library surface of this package — what `import "@needmoretruth/nmts-cli"` hands a program.
//
// ⛔ THIS IS NOT THE COMMAND. `main.ts` is what the `nmts` binary runs; nothing here parses
//    arguments, prints, prompts or exits. Everything re-exported below takes its inputs as values
//    and reports through return values and thrown `NmtsError`s, which is what lets another
//    package — the SDK, or somebody's own server — build on it without inheriting a terminal.
//
// ⛔ ONLY MODULES THAT NEVER TOUCH A TERMINAL ARE HERE. `code-access.ts`, `api-key.ts`,
//    `session.ts` and every `commands/*` file can stop to ask a person something, and a library
//    that stops to ask on somebody's server is a library that hangs. A program that wants the
//    account code from the environment reads `credentials.ts` and decides for itself.
//
// ⚠ THE PACKAGE'S `exports` MAP NAMES THIS FILE AND A FEW OF THE MODULES BELOW BY SUBPATH. A
//   module not named there is reachable through this file only; adding a subpath is a promise
//   that its shape stays put, so it is done on purpose and one at a time.

// Errors — the one shape every failure below arrives in.
export { NmtsError, NotLoggedInError, renderError } from "./errors.ts";

// The server: one request function, and what a refusal looks like.
export { request, ServerError, DEFAULT_TIMEOUT_MS } from "./api.ts";
export type { RequestOptions, ServerRefusal } from "./api.ts";
export { DEFAULT_SERVER, SERVER_ENV_VAR, resolveServer } from "./server.ts";
export { NETWORKS, NETWORK_ENV_VAR, resolveNetwork } from "./network.ts";
export type { Network } from "./network.ts";

// Where a credential can come from on this machine. Reading is here; ASKING is not.
export {
  API_KEY_ENV_VAR,
  API_KEY_FILE_ENV_VAR,
  CODE_ENV_VAR,
  CODE_FILE_ENV_VAR,
  configDir,
  readSecretFile,
  resolveAccountCode,
  resolveApiKey,
} from "./credentials.ts";
export type { CredentialSource, ResolvedCode } from "./credentials.ts";

// The account: what a code derives, and the engine that derives it.
export { assertUsableCode, identityOf } from "./account.ts";
export type { AccountIdentity } from "./account.ts";
export { AAD, DERIVED, loadCrypto } from "./crypto.ts";
export type { CryptoGlue } from "./crypto.ts";

// The sealed file list: reading it, editing it, and walking it by path.
export { readFileList } from "./manifest.ts";
export type { FileList } from "./manifest.ts";
export { addEntry, applyManyToList, applyToList, planAddition } from "./manifest-write.ts";
export type { AddEntryInput, AddEntryResult, ListEditInput, ListEditResult } from "./manifest-write.ts";
export type { Manifest, ManifestEntry } from "./shared/lib/drive/manifest-codec.ts";
export {
  buildIndex,
  entryAt,
  folderIdFor,
  fullPathOf,
  isLive,
  KIND_FILE,
  KIND_FOLDER,
  namesIn,
  normalisePath,
  trashedAt,
} from "./drive-paths.ts";
export type { FindOptions, ManifestIndex } from "./drive-paths.ts";
export { setTrashed } from "./item-trash.ts";

// Uploading: sealing here, buying storage with credits, pushing the sealed bytes.
export { fileSource, partKeysOf, uploadFile } from "./upload-file.ts";
export type { FileUploadInput, FileUploadStep, PlaintextSource } from "./upload-file.ts";
export { createUploadApi } from "./upload-api.ts";
export {
  CREDIT_BYTES,
  creditsFor,
  measureLocal,
  partSizeFor,
  planAndPrice,
  UPLOAD_EPOCHS,
} from "./upload-price.ts";
export { clearItemRecord, clearReservation } from "./upload-store.ts";
export { UploadError } from "./upload-wire.ts";
export type { BlobProtocol, UploadApi, UploadResult, UploadStep } from "./upload-wire.ts";
export type { PaddingRule } from "./shared/lib/crypto/size-padding.ts";
export { DEFAULT_PART_BYTES } from "./seal.ts";
export { createBlobProtocol, readCurrentEpoch } from "./walrus-write.ts";

// Downloading: fetching sealed parts from the storage network and opening them here.
export { fetchFile, fetchWithKey } from "./download.ts";
export type { FetchedFile, FetchInput } from "./download.ts";
export { fileSink } from "./download-sink.ts";
export type { PlaintextSink } from "./download-sink.ts";
export { AGGREGATOR_ENV_VAR, readBlob, RELAY_ENV_VAR, SUI_RPC_ENV_VAR } from "./walrus.ts";
export type { ReadOptions } from "./walrus.ts";

// The wallet the account code derives: reading it, and signing with it.
export { coinAmount, readBalances, walletAddress } from "./wallet.ts";
export type { ChainReader, CoinBalance, WalletBalances } from "./wallet.ts";
export { chainReader } from "./wallet-chain.ts";
export { signerAddress, signExtension, signTransfer } from "./wallet-sign.ts";
export type { SignTransfer } from "./wallet-sign.ts";

// What this package is.
export { HOME_URL, PRODUCT_NAME, SOURCE_URL, SUPPORT_EMAIL, VERSION } from "./product.ts";
