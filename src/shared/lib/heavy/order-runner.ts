// Drive one NMTS Heavy upload from start to finish: open the order, place and upload every sealed
// part, wait until each is stored, pay if the wallet pays, and hand back the parts to commit.
//
// ⚠ THIS FILE IS PUBLISHED. It is copied byte-for-byte into the `nmts` command-line package.
//   Keep the comments self-contained English, with no pointer only we can follow.
//
// EVERY EDGE IS INJECTED — the order routes, the sealer, the PieceCID, the upload, the clock and the
// wait. The browser and the command line plug in their own; a test plugs in fakes. Nothing in here
// touches the network or a key on its own.
//
// THE ORDER OF THINGS (one upload = one order, however many files):
//   1. open    `createOrder` with one slot per sealed part, numbered across the files in order.
//              Retried under the SAME idempotency key when the answer is lost, so it is charged once.
//   2. per slot, a few at a time (default 2):
//              seal → check the sealed size is the one the order was opened with → PieceCID →
//              `targetSlot` (where to upload) → upload to that company → `slotUploaded` →
//              read the order until the slot is `stored` (bounded, with backoff) or `failed`.
//   3. pay     wallet orders only, after EVERY slot is stored: the injected `payWallet` sends the WAL
//              and returns the Sui transaction digest, which is reported with `markPaid`.
//   4. return  per file, the parts to commit (`network` 1, `blob_id` = PieceCID, the order and slot,
//              the copies, and the Filecoin epoch they are kept until).
//
// ⛔ A FAILURE STOPS EVERYTHING AND SAYS WHY IN A WORD (`HeavyOrderError.reason`). Nothing is cleaned
//    up from here: the server removes whatever an order stored if no file is committed from it within
//    a day, and gives back the credits for slots that were never stored.

import { heavyRefusalOf, type HeavyCopy, type HeavyOrderView } from "../api/types-heavy.ts";
import { heavyOrderRequest, planSlots, type SlotPlan } from "./order-plan.ts";
import type {
  HeavyProgress,
  HeavyRunDeps,
  HeavyRunOptions,
  HeavyRunResult,
  SealedBytes,
} from "./order-types.ts";
import {
  abortError,
  codeOf,
  defaultSleep,
  HeavyOrderError,
  isAbort,
  isHttpsUrl,
  isTransient,
  readCopies,
} from "./order-wire.ts";

export {
  HEAVY_MAX_SLOTS,
  HEAVY_MIN_SEAL_FROM_BYTES,
  HEAVY_PART_SIZE_BYTES,
  HEAVY_PIECE_MAX_BYTES,
  HEAVY_PIECE_MIN_BYTES,
  heavyOrderRequest,
  type HeavyOrderRequestBody,
  type HeavyPayment,
  type HeavyRunFile,
  type HeavyRunPart,
} from "./order-plan.ts";
export { HeavyOrderError, type HeavyFailure } from "./order-wire.ts";
export type {
  HeavyProgress,
  HeavyRunDeps,
  HeavyRunOptions,
  HeavyRunResult,
  HeavySealJob,
  SealedBytes,
} from "./order-types.ts";

type Stored = { cid: string; copies: HeavyCopy[] };

function sizeOf(bytes: SealedBytes): number {
  return bytes instanceof Uint8Array ? bytes.byteLength : bytes.size;
}

/**
 * Run one Heavy upload to the end. Resolves with the parts to commit; rejects with a
 * `HeavyOrderError`, or with an AbortError when `options.signal` aborts.
 */
export async function runHeavyOrder(
  options: HeavyRunOptions,
  deps: HeavyRunDeps,
): Promise<HeavyRunResult> {
  const plans = planSlots(options.files);
  const { api } = deps;
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? (() => Date.now());
  const concurrency = Math.max(1, options.concurrency ?? 2);
  const pollStart = options.pollIntervalMs ?? 3_000;
  const pollMax = options.pollMaxIntervalMs ?? 30_000;
  const storeTimeout = options.storeTimeoutMs ?? 60 * 60 * 1000;
  const uploadAttempts = Math.max(1, options.uploadAttempts ?? 3);
  const idempotencyKey =
    options.idempotencyKey ?? deps.newIdempotencyKey?.() ?? globalThis.crypto.randomUUID();
  const emit = (event: HeavyProgress) => options.onProgress?.(event);

  // One controller for the run: the caller's abort, or the first slot that fails, stops the rest.
  if (options.signal?.aborted) throw abortError();
  const run = new AbortController();
  const onOuterAbort = () => run.abort();
  options.signal?.addEventListener("abort", onOuterAbort, { once: true });
  const signal = run.signal;
  let orderId: string | null = null;

  /** One api call, made again after 1, 2, 4… s when it failed for a reason unrelated to the request. */
  async function call<T>(what: string, fn: () => Promise<T>, slot: number | null): Promise<T> {
    const attempts = 5;
    for (let attempt = 1; ; attempt += 1) {
      if (signal.aborted) throw abortError();
      try {
        return await fn();
      } catch (err) {
        if (isAbort(err)) throw err;
        const code = codeOf(err);
        if (!isTransient(err)) {
          throw new HeavyOrderError("refused", `${what} was refused (${code ?? "no code"}).`, {
            refusal: code === null ? null : heavyRefusalOf(code),
            orderId,
            slot,
            cause: err,
          });
        }
        if (attempt >= attempts) {
          throw new HeavyOrderError("unreachable", `${what} failed ${attempts} times.`, {
            orderId,
            slot,
            cause: err,
          });
        }
        await sleep(1000 * 2 ** (attempt - 1), signal);
      }
    }
  }

  const readOrder = (id: string, slot: number | null) =>
    call("Reading the order", () => api.getOrder(id, { signal }), slot);

  /**
   * Report the payment. A just-sent transaction may not be readable yet where the server looks, so
   * "not found" is asked again a few times; "already used" means an earlier report landed and its
   * answer was lost, which the order's own state confirms.
   */
  async function reportPayment(id: string, digest: string): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await call("Reporting the payment", () => api.markPaid(id, { tx_digest: digest }, { signal }), null);
        return;
      } catch (err) {
        const refusal = err instanceof HeavyOrderError ? err.refusal : null;
        if (refusal === "payment_not_found" && attempt < 6) {
          await sleep(5000 * attempt, signal);
          continue;
        }
        if (refusal === "digest_used") {
          const view = await readOrder(id, null);
          if (view.state === "paid" || view.state === "bound") return;
        }
        if (err instanceof HeavyOrderError && err.reason === "refused") {
          throw new HeavyOrderError("payment_refused", `The payment ${digest} was not accepted.`, {
            refusal,
            orderId: id,
            cause: err,
          });
        }
        throw err;
      }
    }
  }

  try {
    // 1. Open (or reach again) the order.
    const request = heavyOrderRequest(options.files, options.payment, idempotencyKey);
    const created = await call("Opening the order", () => api.createOrder(request, { signal }), null);
    if (typeof created.order_id !== "string" || created.slots?.length !== plans.length) {
      throw new HeavyOrderError("bad_answer", "The order came back without the slots it was opened with.");
    }
    const id = created.order_id;
    orderId = id;
    if (options.payment.pay === "wallet" && created.price === undefined) {
      throw new HeavyOrderError("bad_answer", "A wallet order came back without a price.", { orderId: id });
    }
    emit({ phase: "opened", orderId: id, order: created });

    // What the order already holds: a run that reaches an existing order does not redo stored slots.
    const before = await readOrder(id, null);
    let latest: HeavyOrderView = before;
    const results = new Map<number, Stored>();

    /** Read the order until this slot is stored; fail on a failed slot, a failed order or the deadline. */
    async function waitStored(plan: SlotPlan, cid: string | null): Promise<Stored> {
      const deadline = now() + storeTimeout;
      const where = { orderId: id, slot: plan.slot };
      for (let interval = pollStart; ; interval = Math.min(pollMax, Math.round(interval * 1.5))) {
        const view = await readOrder(id, plan.slot);
        latest = view;
        if (view.state === "failed" || view.state === "expired") {
          throw new HeavyOrderError("order_failed", `The order is ${view.state}.`, where);
        }
        const slot = view.slots?.find((s) => s.slot === plan.slot);
        if (slot?.state === "failed" || slot?.state === "removed") {
          const why = slot.error ? `: ${slot.error}` : "";
          throw new HeavyOrderError(
            "slot_failed",
            `Part ${plan.partIndex} of "${plan.fileKey}" was not stored (${slot.state}${why}).`,
            where,
          );
        }
        if (slot?.state === "stored") {
          const copies = readCopies(slot.copies);
          const stored = slot.piece_cid ?? cid;
          if (copies === null || typeof stored !== "string" || (cid !== null && stored !== cid)) {
            throw new HeavyOrderError(
              "bad_answer",
              `Slot ${plan.slot} is stored, but its copies or piece id do not add up.`,
              where,
            );
          }
          return { cid: stored, copies };
        }
        if (now() >= deadline) {
          const minutes = Math.round(storeTimeout / 60_000);
          throw new HeavyOrderError(
            "store_timeout",
            `Part ${plan.partIndex} of "${plan.fileKey}" was not stored within ${minutes} minutes.`,
            where,
          );
        }
        await sleep(interval, signal);
      }
    }

    async function processSlot(plan: SlotPlan): Promise<void> {
      const at = { slot: plan.slot, fileKey: plan.fileKey, partIndex: plan.partIndex };
      const where = { orderId: id, slot: plan.slot };
      const known = before.slots?.find((s) => s.slot === plan.slot);
      if (known?.state === "stored" || known?.state === "committing") {
        results.set(plan.slot, await waitStored(plan, known.piece_cid ?? null));
        emit({ phase: "stored", ...at });
        return;
      }
      emit({ phase: "sealing", ...at });
      const job = { fileKey: plan.fileKey, partIndex: plan.partIndex, slot: plan.slot, sealedLen: plan.sealedLen };
      const bytes = await deps.seal(job, signal);
      if (signal.aborted) throw abortError();
      if (sizeOf(bytes) !== plan.sealedLen) {
        throw new HeavyOrderError(
          "sealed_len_mismatch",
          `Part ${plan.partIndex} of "${plan.fileKey}" sealed to ${sizeOf(bytes)} bytes, ` +
            `not the ${plan.sealedLen} the order was opened for.`,
          where,
        );
      }
      emit({ phase: "hashing", ...at });
      const cid = await deps.pieceCid(bytes);
      emit({ phase: "placing", ...at });
      const target = await call(
        "Placing the part",
        () => api.targetSlot(id, plan.slot, { piece_cid: cid }, { signal }),
        plan.slot,
      );
      if (!isHttpsUrl(target.service_url)) {
        throw new HeavyOrderError("bad_answer", "The server named no https storage service for this part.", where);
      }
      for (let attempt = 1; ; attempt += 1) {
        try {
          await deps.upload({
            serviceUrl: target.service_url,
            bytes,
            pieceCid: cid,
            signal,
            onProgress: (sentBytes, totalBytes) =>
              emit({ phase: "uploading", ...at, sentBytes, totalBytes }),
          });
          break;
        } catch (err) {
          if (isAbort(err) || signal.aborted) throw err;
          if (attempt >= uploadAttempts) {
            throw new HeavyOrderError(
              "upload_failed",
              `Uploading part ${plan.partIndex} of "${plan.fileKey}" failed ${uploadAttempts} times.`,
              { ...where, cause: err },
            );
          }
          await sleep(2000 * 2 ** (attempt - 1), signal);
        }
      }
      emit({ phase: "committing", ...at });
      await call("Reporting the upload", () => api.slotUploaded(id, plan.slot, { signal }), plan.slot);
      results.set(plan.slot, await waitStored(plan, cid));
      emit({ phase: "stored", ...at });
    }

    // 2. The slots, a few at a time. The first failure aborts the others and is the one reported.
    let firstFailure: unknown = null;
    let next = 0;
    const worker = async (): Promise<void> => {
      for (let plan = plans[next]; firstFailure === null && plan !== undefined; plan = plans[next]) {
        next += 1;
        try {
          await processSlot(plan);
        } catch (err) {
          if (firstFailure === null) firstFailure = err;
          run.abort();
          return;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, plans.length) }, worker));
    if (firstFailure !== null) {
      // When the caller aborted, every slot reports an abort; say so rather than the first of them.
      if (options.signal?.aborted) throw abortError();
      throw firstFailure;
    }

    // The epoch the copies are kept until is set once every slot is stored: the last read has it,
    // or a read or two later does.
    let view = latest;
    for (let tries = 0; typeof view.expiry_epoch !== "number" && tries < 5; tries += 1) {
      await sleep(pollStart, signal);
      view = await readOrder(id, null);
    }
    const expiryEpoch = view.expiry_epoch;
    if (typeof expiryEpoch !== "number") {
      throw new HeavyOrderError("bad_answer", "Every part is stored but the order names no end epoch.", {
        orderId: id,
      });
    }

    // 3. Pay, when the wallet pays — once, after everything is stored, and not again on a rerun.
    let txDigest: string | undefined;
    const price = created.price;
    if (options.payment.pay === "wallet" && price && view.state !== "paid" && view.state !== "bound") {
      emit({ phase: "paying", orderId: id, price });
      txDigest = await options.payment.payWallet(price, id);
      await reportPayment(id, txDigest);
      emit({ phase: "paid", orderId: id, txDigest });
    }

    // 4. The parts to commit, per file.
    const files: HeavyRunResult["files"] = options.files.map((file) => ({ key: file.key, parts: [] }));
    for (const plan of plans) {
      const done = results.get(plan.slot);
      const file = files[plan.fileIndex];
      if (done === undefined || file === undefined) {
        throw new HeavyOrderError("bad_answer", `Slot ${plan.slot} finished without a result.`, { orderId: id });
      }
      file.parts.push({
        part_index: plan.partIndex,
        storage_kind: 0,
        network: 1,
        blob_id: done.cid,
        sealed_len: plan.sealedLen,
        owner_kind: 1,
        expiry_epoch: expiryEpoch,
        heavy_order_id: id,
        heavy_slot: plan.slot,
        copies: done.copies,
      });
    }
    return {
      orderId: id,
      idempotencyKey,
      expiryEpoch,
      ...(created.credits === undefined ? {} : { credits: created.credits }),
      ...(txDigest === undefined ? {} : { txDigest }),
      files,
    };
  } finally {
    options.signal?.removeEventListener("abort", onOuterAbort);
  }
}
