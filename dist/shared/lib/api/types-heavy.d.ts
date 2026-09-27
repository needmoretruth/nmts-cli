/** One stored copy of a Heavy part: which company holds it, where on chain, and where to read it. */
export interface HeavyCopy {
    /** The storage company's registry id. */
    provider_id: string;
    /** The on-chain data set the piece was added to. */
    data_set_id: string;
    /** The piece's id inside that data set. */
    piece_id: string;
    /** `https://<company>/piece/<PieceCID>` — public, no credentials, byte ranges allowed. */
    retrieval_url: string;
}
/** The field a Filecoin (network 1) part carries on every read and on commit. */
export interface HeavyPartCopies {
    /** Where the part's copies are kept. Present on network-1 parts only; absent means Walrus. */
    copies?: HeavyCopy[];
}
/** The fields that tie a committed part to the order and slot that paid for it. */
export interface HeavyOrderBinding {
    /** The order that paid for this part. Omitted on the self-paid path, which has no order. */
    heavy_order_id?: string;
    /** Which slot of that order this part is. */
    heavy_slot?: number;
}
/** How an order is paid. */
export type HeavyPay = "credits" | "wallet";
/** One slot asked for when an order opens: its number and the exact sealed size it will upload. */
export interface HeavySlotRequest {
    /** 0..n-1, one per sealed part across every file of the upload. */
    slot: number;
    /** Bytes of the sealed part, 127..=1_065_353_216 — known before sealing. */
    sealed_len: number;
}
/** `POST /v1/heavy/orders` body. */
export interface HeavyCreateOrderRequest {
    /** 16..64 of `[A-Za-z0-9_-]`. The same key and body answer the same order; nothing is charged twice. */
    idempotency_key: string;
    /** 1..=256 slots. */
    slots: HeavySlotRequest[];
    pay: HeavyPay;
    /** Wallet orders only: 1..=365 days. Credit orders are always 28. */
    term_days?: number;
    /** Wallet orders only: the `0x` + 64-hex Sui address that will pay. */
    payer?: string;
}
/** What a wallet order costs, and where the payment goes. */
export interface HeavyPrice {
    /** The price in FROST (1 WAL = 10^9 FROST), as a decimal string. */
    wal_frost: string;
    /** The `0x` + 64-hex Sui address the WAL is sent to. */
    treasury: string;
    /** How long after every slot is stored the payment may arrive before the copies are removed. */
    pay_within_secs: number;
}
export type HeavyOrderState = "open" | "stored" | "paid" | "bound" | "expired" | "failed";
export type HeavySlotState = "open" | "targeted" | "committing" | "stored" | "failed" | "removed";
/** `POST /v1/heavy/orders` 200. */
export interface HeavyOrderCreated {
    order_id: string;
    state: "open";
    pay: HeavyPay;
    term_days: number;
    /** Credit orders: what was taken. */
    credits?: number;
    /** Wallet orders: what will be owed once everything is stored. */
    price?: HeavyPrice;
    slots: {
        slot: number;
        state: "open";
    }[];
}
/** One slot as `GET /v1/heavy/orders/{id}` reports it. */
export interface HeavySlotView {
    slot: number;
    state: HeavySlotState;
    piece_cid?: string;
    /** Present once the slot is stored. */
    copies?: HeavyCopy[];
    /** Why a failed slot failed, as the server words it for a log. */
    error?: string;
}
/** `GET /v1/heavy/orders/{id}` 200. */
export interface HeavyOrderView {
    order_id: string;
    state: HeavyOrderState;
    pay: HeavyPay;
    term_days: number;
    price?: HeavyPrice;
    /** The Filecoin epoch (30 s) the copies are kept until; set once every slot is stored. */
    expiry_epoch?: number;
    slots: HeavySlotView[];
}
/** `POST …/slots/{slot}/target` body. */
export interface HeavyTargetRequest {
    /** The part's FRC-0069 PieceCID (`bafkzcib…`); its raw size must equal the slot's `sealed_len`. */
    piece_cid: string;
}
/** `POST …/slots/{slot}/target` 200 — where to upload this slot's bytes. */
export interface HeavySlotTarget {
    provider_id: string;
    /** The company's service origin; the upload goes to `<service_url>/pdp/piece/uploads`. */
    service_url: string;
}
/** `POST …/slots/{slot}/uploaded` 202. */
export interface HeavyUploadedReply {
    state: "committing";
}
/** `POST …/paid` body — the Sui transaction that sent the WAL. */
export interface HeavyPaidRequest {
    tx_digest: string;
}
/** `POST …/paid` 200. */
export interface HeavyPaidReply {
    state: "paid";
}
/** Per-call options every order route accepts. */
export interface HeavyCallOptions {
    signal?: AbortSignal;
}
/**
 * The order routes as one object. The browser builds it over its api client; the command line
 * builds it over its own. The upload orchestrator depends on nothing but this.
 */
export interface HeavyOrderApi {
    createOrder(body: HeavyCreateOrderRequest, options?: HeavyCallOptions): Promise<HeavyOrderCreated>;
    getOrder(orderId: string, options?: HeavyCallOptions): Promise<HeavyOrderView>;
    targetSlot(orderId: string, slot: number, body: HeavyTargetRequest, options?: HeavyCallOptions): Promise<HeavySlotTarget>;
    slotUploaded(orderId: string, slot: number, options?: HeavyCallOptions): Promise<HeavyUploadedReply>;
    markPaid(orderId: string, body: HeavyPaidRequest, options?: HeavyCallOptions): Promise<HeavyPaidReply>;
}
/**
 * A finished Heavy part, ready to go into `POST /v1/items` as one of a file's parts.
 *
 * Structurally one of that route's part inputs: the treasury owns order-paid storage (`owner_kind`
 * 1), the part is a whole piece rather than a quilt patch (`storage_kind` 0), and `blob_id` holds
 * the PieceCID — the id the Filecoin network knows the bytes by.
 */
export interface HeavyPartCommit {
    part_index: number;
    storage_kind: 0;
    network: 1;
    blob_id: string;
    sealed_len: number;
    owner_kind: 1;
    /** A Filecoin epoch, not a Walrus one: the unit is the network's own. */
    expiry_epoch: number;
    heavy_order_id: string;
    heavy_slot: number;
    copies: HeavyCopy[];
}
/**
 * Every refusal the order routes can answer, by the name the contract gives it.
 *
 *   credits_insufficient · idempotency_conflict · file_credits_cap · day_credits_cap ·
 *   heavy_wallet_pay_off · heavy_price_unavailable · unpaid_orders_cap ·
 *   heavy_unavailable                                                  (opening an order)
 *   piece_cid_invalid · piece_size_mismatch · slot_state               (placing a slot)
 *   not_stored · payment_not_found · payment_mismatch · digest_used   (reporting a payment)
 */
export declare const HEAVY_REFUSALS: readonly ["credits_insufficient", "idempotency_conflict", "file_credits_cap", "day_credits_cap", "heavy_wallet_pay_off", "heavy_price_unavailable", "unpaid_orders_cap", "heavy_unavailable", "piece_cid_invalid", "piece_size_mismatch", "slot_state", "not_stored", "payment_not_found", "payment_mismatch", "digest_used"];
export type HeavyRefusal = (typeof HEAVY_REFUSALS)[number];
/**
 * The Heavy refusal an error code names, or `null` when it names none.
 *
 * Letter case is ignored: servers spell error codes in capitals (`CREDITS_INSUFFICIENT`) and the
 * contract writes them in lower case, and both mean one thing.
 */
export declare function heavyRefusalOf(code: string): HeavyRefusal | null;
