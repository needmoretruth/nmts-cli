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
//    NMTS key from the environment reads `credentials.ts` and decides for itself.
//
// ⚠ THE PACKAGE'S `exports` MAP NAMES THIS FILE AND A FEW OF THE MODULES BELOW BY SUBPATH. A
//   module not named there is reachable through this file only; adding a subpath is a promise
//   that its shape stays put, so it is done on purpose and one at a time.
// Errors — the one shape every failure below arrives in.
export { NmtsError, NotLoggedInError, renderError } from "./errors.js";
// The server: one request function, and what a refusal looks like.
export { request, ServerError, DEFAULT_TIMEOUT_MS } from "./api.js";
export { DEFAULT_SERVER, SERVER_ENV_VAR, resolveServer } from "./server.js";
export { NETWORKS, NETWORK_ENV_VAR, resolveNetwork } from "./network.js";
// Where a credential can come from on this machine. Reading is here; ASKING is not.
export { API_KEY_ENV_VAR, API_KEY_FILE_ENV_VAR, CODE_ENV_VAR, CODE_FILE_ENV_VAR, configDir, readSecretFile, resolveAccountCode, resolveApiKey, } from "./credentials.js";
// The account: what a code derives, and the engine that derives it.
export { assertUsableCode, identityOf } from "./account.js";
export { AAD, DERIVED, loadCrypto } from "./crypto.js";
// The sealed file list: reading it, editing it, and walking it by path.
export { readFileList } from "./manifest.js";
export { addEntry, applyManyToList, applyToList, planAddition } from "./manifest-write.js";
export { buildIndex, entryAt, folderIdFor, fullPathOf, isLive, KIND_FILE, KIND_FOLDER, namesIn, normalisePath, trashedAt, } from "./drive-paths.js";
export { setTrashed } from "./item-trash.js";
// Uploading: sealing here, buying storage with credits, pushing the sealed bytes.
export { fileSource, partKeysOf, uploadFile } from "./upload-file.js";
export { createUploadApi } from "./upload-api.js";
export { CREDIT_BYTES, creditsFor, measureLocal, partSizeFor, planAndPrice, UPLOAD_EPOCHS, } from "./upload-price.js";
export { clearItemRecord, clearReservation } from "./upload-store.js";
export { UploadError } from "./upload-wire.js";
export { DEFAULT_PART_BYTES } from "./seal.js";
export { createBlobProtocol, readCurrentEpoch } from "./walrus-write.js";
// Uploading paid by the account's OWN WALLET instead of credits: the same seal-buy-push-record
// path, priced and refused before anything is signed. `nmts put --pay wallet` is this plus a
// terminal; the spending ledger and the standing gift are the command's and are not here.
export { walletPut } from "./upload-wallet-put.js";
export { DEFAULT_UPLOAD_EPOCHS } from "./upload-wallet-plan.js";
// Downloading: fetching sealed parts from the storage network and opening them here.
export { fetchFile, fetchWithKey } from "./download.js";
export { fileSink } from "./download-sink.js";
export { AGGREGATOR_ENV_VAR, readBlob, RELAY_ENV_VAR, SUI_RPC_ENV_VAR } from "./walrus.js";
// The wallet the NMTS key derives: reading it, and signing with it.
export { coinAmount, readBalances, walCoinType, walletAddress } from "./wallet.js";
export { chainReader } from "./wallet-chain.js";
export { signerAddress, signExtension, signTransfer } from "./wallet-sign.js";
// WHICH of this key's wallets, and which of them have been used. One key derives a wallet at every
// index (NCF-3 §1.3), so the account's own number is read out of the sealed list and the rest is a
// walk. Both are here so that a library built on this package finds the SAME wallets under the same
// numbers as `nmts wallet list` — a second walk, or a second reading of the setting, would be a
// second answer to a question that has to have exactly one.
export { activeWalletOf, walletCountOf, WALLET_INDEX_LIMIT } from "./shared/lib/drive/manifest-settings.js";
export { discoverWallets, WALLET_SCAN_GAP } from "./shared/lib/wallet/discover.js";
export { hasHistory } from "./wallet-list-chain.js";
// What this package is.
export { HOME_URL, PRODUCT_NAME, SOURCE_URL, SUPPORT_EMAIL, VERSION } from "./product.js";
