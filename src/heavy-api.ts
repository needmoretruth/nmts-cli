// NMTS Heavy's order routes over this package's one request function — the `HeavyOrderApi` the
// shared order runner (`shared/lib/heavy/order-runner.ts`) drives — and the commit of a finished
// Heavy file.
//
// ⛔ THE RUNNER READS ERRORS BY SHAPE: a string `code` and a number `status`. A server refusal
//    already carries both (`ServerError`). A line that dropped does not — `request` throws a plain
//    `NmtsError` for it — so it is handed on here with the transport word `NETWORK`, which is the
//    one the runner asks again on. Everything else passes through untouched, so a refusal the
//    server explained still prints the way every other refusal does.
//
// ⛔ NO `node:` IMPORT. The SDK's browser entry reaches this file through `portable.ts`.

import { HttpError, request, ServerError } from "./api.ts";
import { NmtsError } from "./errors.ts";
import { isRecord } from "./guards.ts";
import { HEAVY_COPY } from "./heavy-copy.ts";
import type {
  HeavyCopy,
  HeavyOrderApi,
  HeavyOrderCreated,
  HeavyOrderView,
  HeavyPaidReply,
  HeavyPartCommit,
  HeavySlotTarget,
  HeavyUploadedReply,
} from "./shared/lib/api/types-heavy.ts";

/** How long a route that reaches the chain service gets. The same as the credit rail's. */
const CHAIN_TIMEOUT_MS = 120_000;

/** A line that dropped, in the shape the order runner retries. */
export class HeavyTransportError extends NmtsError {
  readonly code = "NETWORK";
  constructor(cause: NmtsError) {
    super(cause.message, { exitCode: cause.exitCode, nextStep: cause.nextStep });
    this.name = "HeavyTransportError";
  }
}

async function call<T>(fn: () => Promise<unknown>, read: (value: unknown) => T): Promise<T> {
  let value: unknown;
  try {
    value = await fn();
  } catch (error) {
    if (error instanceof ServerError || error instanceof HttpError || !(error instanceof NmtsError)) throw error;
    throw new HeavyTransportError(error);
  }
  return read(value);
}

/**
 * The answer as the contract types it.
 *
 * ⚠ CHECKED FOR BEING AN OBJECT AND NOTHING MORE HERE: the runner checks every field it acts on
 *   (the slots it opened, the https address it uploads to, each copy) before it acts on it, and
 *   says `bad_answer` when one is missing. Two checks of one answer would be two answers to what a
 *   well-formed one is.
 */
function answer<T>(value: unknown): T {
  if (!isRecord(value)) throw new NmtsError("The server's answer about the Heavy order was not an object.");
  // ⚠ The one assertion in this file, for the reason above: the runner reads each field by shape.
  return value as T;
}

/** The order routes, bound to one server and one credential. */
export function createHeavyApi(server: string, bearer: string): HeavyOrderApi {
  const order = (id: string) => encodeURIComponent(id);
  return {
    createOrder: (body, options) =>
      call(
        () => request(server, "/v1/heavy/orders", { method: "POST", token: bearer, body, timeoutMs: CHAIN_TIMEOUT_MS, signal: options?.signal }),
        answer<HeavyOrderCreated>,
      ),
    getOrder: (id, options) =>
      call(() => request(server, `/v1/heavy/orders/${order(id)}`, { token: bearer, signal: options?.signal }), answer<HeavyOrderView>),
    targetSlot: (id, slot, body, options) =>
      call(
        () =>
          request(server, `/v1/heavy/orders/${order(id)}/slots/${slot}/target`, {
            method: "POST",
            token: bearer,
            body,
            timeoutMs: CHAIN_TIMEOUT_MS,
            signal: options?.signal,
          }),
        answer<HeavySlotTarget>,
      ),
    slotUploaded: (id, slot, options) =>
      call(
        () =>
          request(server, `/v1/heavy/orders/${order(id)}/slots/${slot}/uploaded`, {
            method: "POST",
            token: bearer,
            body: {},
            timeoutMs: CHAIN_TIMEOUT_MS,
            signal: options?.signal,
          }),
        answer<HeavyUploadedReply>,
      ),
    markPaid: (id, body, options) =>
      call(
        () =>
          request(server, `/v1/heavy/orders/${order(id)}/paid`, {
            method: "POST",
            token: bearer,
            body,
            timeoutMs: CHAIN_TIMEOUT_MS,
            signal: options?.signal,
          }),
        answer<HeavyPaidReply>,
      ),
  };
}

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
export async function commitHeavyItem(input: {
  server: string;
  bearer: string;
  idempotencyKey: string;
  dekWrapped: string;
  contentHashCt: string;
  parts: readonly (HeavyPartCommit | HeavySelfPaidPart)[];
  /** Self-paid only: the `0x` EVM address that paid. */
  paidBy?: string | undefined;
}): Promise<string> {
  const reply = await request(input.server, "/v1/items", {
    method: "POST",
    token: input.bearer,
    idempotencyKey: input.idempotencyKey,
    timeoutMs: CHAIN_TIMEOUT_MS,
    body: {
      size: input.parts.reduce((sum, part) => sum + part.sealed_len, 0),
      dek_wrapped: input.dekWrapped,
      content_hash_ct: input.contentHashCt,
      visibility: 0,
      parts: input.parts,
      ...(input.paidBy === undefined ? {} : { paid_by: input.paidBy }),
    },
  });
  const id = isRecord(reply) ? reply["id"] : undefined;
  if (typeof id !== "string" || id === "") {
    throw new NmtsError(HEAVY_COPY.commitNoId, { nextStep: HEAVY_COPY.commitNoIdNext });
  }
  return id;
}
