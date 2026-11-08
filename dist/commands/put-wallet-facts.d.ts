import type { WalletPutReview } from "../upload-wallet-put.ts";
/** The review as `--json` prints it: base units as strings, with the coin amounts beside them. */
export declare function factsOf(review: WalletPutReview): Record<string, unknown>;
