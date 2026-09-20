// The library surface that runs ANYWHERE — what `import "@needmoretruth/nmts-cli/portable"` hands
// a program that brought its own host.
//
// ⛔ THIS IS `index.ts` MINUS THE THINGS THAT NEED NODE, and it is the file the machine check
//    judges. `test/portable-closure.test.ts` walks everything reachable from the built version of
//    this file and fails on a `node:` import, a `process.`, a `Buffer.` or an `import.meta.url` —
//    by file and by line. So this is not a promise anybody has to remember: a module that grows a
//    dependency on Node turns this red on the day it is written.
//
// ⛔ IT REGISTERS NO HOST. Loading the engine, keeping state, reading the environment, reporting
//    progress and expanding zstd all come from `host.ts`, and whoever imports this entry point
//    puts one there first. `index.ts` registers the Node host on the way in, so every existing
//    program is unaffected; the SDK's `/browser` entry registers a browser one.
//
// ⛔ WHAT IS NOT HERE, AND WHY. `credentials.ts` reads a home directory, `code-vault.ts` opens a
//    passphrase-locked file, `fileSink`, `stdoutSink`, `fileSource` and `measureLocal` each take or
//    give a path, and `Nmts.fromEnv` reads an environment. All of them are in `index.ts` and none
//    of them has a meaning in a page.
// The host every module below reaches for. A program that imported this entry point registers one.
export { forgetHost, host, hostIsRegistered, registerHost } from "./host.js";
export { hostContract } from "./host-contract.js";
// Where a caller says this client talks, and what it talks through — the addresses the
// command-line tool takes from its environment, and the one `fetch` every request here goes
// through. A library's caller has no environment to write, so this is how it says the same things.
export { forgetReach, reach, reachFetch, useReach } from "./reach.js";
// Bytes to text and back, in the two spellings the format uses.
export { concat, fromBase64Url, fromUtf8, toBase64Url, utf8 } from "./bytes.js";
// The file-list codec's zstd register (NCF-3 §6.3.4). A host fills it with the encoder its runtime
// has; the bound a frame declares is read with `zstdContentSize` before anything is allocated.
export { setZstdCodec, zstdCodec, zstdContentSize } from "./shared/lib/drive/zstd.js";
// Errors — the one shape every failure below arrives in.
export { NmtsError, NotLoggedInError, renderError } from "./errors.js";
// The server: one request function, and what a refusal looks like.
export { request, ServerError, DEFAULT_TIMEOUT_MS } from "./api.js";
export { DEFAULT_SERVER, SERVER_ENV_VAR, resolveServer } from "./server.js";
export { NETWORKS, NETWORK_ENV_VAR, resolveNetwork } from "./network.js";
// The account: what a code derives, and the engine that derives it.
export { assertUsableCode, identityOf } from "./account.js";
export { AAD, DERIVED, loadCrypto } from "./crypto.js";
// The gate every engine load passes, whichever runtime found the build. A host that fetched one
// runs its answer through this rather than trusting it.
export { isCryptoGlue, missingExports } from "./crypto-surface.js";
// The sealed file list: reading it, editing it, and walking it by path.
export { readFileList } from "./manifest.js";
export { addEntry, applyManyToList, applyToList, planAddition } from "./manifest-write.js";
export { buildIndex, entryAt, folderIdFor, fullPathOf, isLive, KIND_FILE, KIND_FOLDER, namesIn, normalisePath, trashedAt, } from "./drive-paths.js";
export { setTrashed } from "./item-trash.js";
// The Platform's two credentials: a business's signature over one request, and the delegation
// token it mints for one of its users. Making either needs no host and no server — a business
// signs on its own machine, and a device that was handed a token presents it from a page — so
// they belong on this side of the line rather than behind the Node entry.
export { businessPublicKey, businessSigningInput, BUSINESS_CONTEXT, BUSINESS_PREFIX, delegationSigningInput, DELEGATION_CONTEXT, DELEGATION_MAX_TTL_SECS, DELEGATION_PREFIX, generateBusinessKeys, mintDelegation, NONCE_LEN, PUBKEY_LEN, rotationProof, rotationSigningInput, ROTATE_CONTEXT, SCOPE_ALL, SCOPE_BITS, scopeMask, signatureHolds, signBusinessRequest, SIGNATURE_LEN, } from "./platform-sign.js";
// What a brand-new account is registered with, derived from its NMTS key and from nothing else.
// ⚠ Here because a business registering a user makes the same pair the account door has always
//   taken — a second derivation for the Platform would be a second answer to one question.
export { newAccountCode, registrationProofOf } from "./registration.js";
// Uploading: sealing here, buying storage with credits, pushing the sealed bytes.
export { partKeysOf, uploadFile } from "./upload-file.js";
export { createUploadApi } from "./upload-api.js";
export { CREDIT_BYTES, creditsFor, partSizeFor, planAndPrice, UPLOAD_EPOCHS } from "./upload-price.js";
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
export { AGGREGATOR_ENV_VAR, readBlob, RELAY_ENV_VAR, SUI_RPC_ENV_VAR } from "./walrus.js";
// ⛔ THE THREE ADDRESS ANSWERS, so that a caller — and a test — can ask what this client WILL talk
//    to rather than finding out from a request that went somewhere else. Each reads what the
//    caller said first, then the environment, then the network's own.
export { relayHost, storageNodesThrough, suiRpcHosts } from "./walrus.js";
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
