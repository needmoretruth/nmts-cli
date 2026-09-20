// Wallet sign-in without a terminal: the message, the signature's judgement, and the four doors an
// opener travels through — decided and handed back rather than printed.
//
// ⛔ ONE IMPLEMENTATION, FOUR CALLERS, which is the whole reason this entry exists. `nmts login
//    --wallet`, `nmts openers`, the SDK and a page are surfaces over these functions: the prompt,
//    the key file, the button, the exit code belong to them. A second implementation of "which
//    bytes are signed, what is compared, when the key bytes are wiped" would be a second place for
//    rules about the account's root secret to be got right — and the copy nobody re-reads is the
//    one that quietly disagrees.
//
// ⛔ WHAT A CALLER IMPORTS IS THIS NAME — `@needmoretruth/nmts-cli/openers` — so the pieces in
//    `openers/` can be split and joined without a single caller changing. Nothing in the folder
//    reaches for `node:`: the SDK's browser entry bundles what this exports, and the one thing
//    that does touch a disk (reading a `suiprivkey1…` file) is the command line's own.
//
// ⛔ AND NOTHING IN THE FOLDER KEEPS A SIGNATURE. It is lent to one piece of work and dropped;
//    nothing exported from here answers with it, and `cli/test/openers.test.ts` proves that the
//    objects these functions return cannot reach one.
export { fetchSlot, KIND_PASSKEY, KIND_WALLET, listOpeners, putOpener, removeOpener, } from "./openers/doors.js";
export { openerMessage, withRepeatedSignature, withSignature } from "./openers/sign.js";
export { addWallet, refuseIfWalletOpensAnAccount, removeWallet, signInWithWallet, walletSlot, } from "./openers/wallet.js";
