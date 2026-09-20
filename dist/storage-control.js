// Storage control without a terminal: what a wallet holds, extending a file's term, and cutting,
// joining and handing over a resource — decided, priced, signed and handed back rather than printed.
//
// ⛔ ONE IMPLEMENTATION, TWO CALLERS, which is the whole reason this entry exists. `nmts extend` and
//    `nmts wallet storage …` are a terminal over these functions: the review a person reads, the
//    question that is asked, the wallet unlock this machine keeps, the exit code. The SDK is
//    somebody else's program and needs the same acts with none of those. A second implementation of
//    "what may be joined with what", or of the order an extension is bought in, would be a second
//    place for rules about money that does not come back to be got right — and the copy nobody
//    re-reads is the one that quietly disagrees.
//
// ⛔ NOTHING HERE WRITES TO A STREAM, PICKS AN EXIT CODE OR ASKS ANYBODY ANYTHING. Every refusal is
//    thrown and every outcome is returned; the words a person reads are the caller's, and so is the
//    agreement — a terminal asks for one, a program makes it by calling.
//
// ⚠ THE PIECES LIVE IN `storage-control/`, AND THIS IS THE DOOR TO THEM. What a caller imports is
//   this name — `@needmoretruth/nmts-cli/storage-control` — so the pieces can be split and joined
//   without a single caller changing. Nothing in the folder reaches for `node:`: the SDK's browser
//   entry bundles what this exports, and the chain and the signer are loaded only when no seam was
//   supplied.
export { formatBytes, listStorage, readOrRefuse } from "./storage-control/list.js";
export { applyExtension, nothingToExtend, planExtension } from "./storage-control/extend.js";
export { planStorageOp, reshapeStorage } from "./storage-control/reshape.js";
export { DEFAULT_EXTEND_EPOCHS } from "./extend-plan.js";
