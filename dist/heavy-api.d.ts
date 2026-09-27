import { NmtsError } from "./errors.ts";
import type { HeavyCopy, HeavyOrderApi, HeavyPartCommit } from "./shared/lib/api/types-heavy.ts";
/** A line that dropped, in the shape the order runner retries. */
export declare class HeavyTransportError extends NmtsError {
    readonly code = "NETWORK";
    constructor(cause: NmtsError);
}
/** The order routes, bound to one server and one credential. */
export declare function createHeavyApi(server: string, bearer: string): HeavyOrderApi;
/** A self-paid Heavy part: no order, the person's own EVM wallet paid (`owner_kind` 0). */
export interface HeavySelfPaidPart {
    part_index: number;
    storage_kind: 0;
    network: 1;
    blob_id: string;
    sealed_len: number;
    owner_kind: 0;
    expiry_epoch: number;
    copies: HeavyCopy[];
}
/**
 * `POST /v1/items` for one Heavy file.
 *
 * ⛔ SAFE TO ASK AGAIN: the idempotency key names this file of this upload, so a commit whose answer
 *    was lost is recognised rather than making a second file out of the same stored pieces.
 */
export declare function commitHeavyItem(input: {
    server: string;
    bearer: string;
    idempotencyKey: string;
    dekWrapped: string;
    contentHashCt: string;
    parts: readonly (HeavyPartCommit | HeavySelfPaidPart)[];
    /** Self-paid only: the `0x` EVM address that paid. */
    paidBy?: string | undefined;
}): Promise<string>;
