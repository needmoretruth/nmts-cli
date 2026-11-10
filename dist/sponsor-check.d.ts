import type { Network } from "./network.ts";
/** What the operator agrees to pay for in ONE transaction. Amounts in base units. */
export interface SponsorPolicy {
    network: Network;
    /** The operator's address: the only sender and gas owner signed for. */
    operator: string;
    /** Bytes the blobs registered or extended may hold in total (unencoded, as registered). */
    maxBytes: number;
    /** The longest term one reservation or extension may buy, in epochs. */
    maxEpochs: number;
    /** WAL the Walrus calls may take, in FROST. */
    maxWalFrost: bigint | number | string;
    /** SUI the transaction may spend — its gas budget plus relay tips — in MIST. */
    maxSuiMist: bigint | number | string;
    /** The highest gas budget accepted, in MIST. Default: `maxSuiMist`. */
    maxGasBudgetMist?: bigint | number | string | undefined;
    /** Pin the Walrus package instead of reading it from the chain. */
    walrusPackageId?: string | undefined;
    /** Pin the relays' tip addresses instead of asking the relays. */
    relayTipAddresses?: readonly string[] | undefined;
}
/** The chain facts a judgement needs. */
export interface SponsorFacts {
    walrusPackageId: string;
    systemObjectId: string;
    relayTipAddresses: readonly string[];
    /** What a blob of `size` bytes occupies once encoded — the chain's own number. */
    encodedLength(size: number): Promise<number>;
    /** The unencoded size of a blob object, or null when it could not be read. */
    blobSize(objectId: string): Promise<number | null>;
}
/** What a passing transaction spends, as decimal strings so a log and JSON carry them whole. */
export interface SponsorSpend {
    walFrost: string;
    /** Gas budget plus tips: the most SUI it can take. */
    suiMist: string;
    gasBudgetMist: string;
    tipMist: string;
    /** Bytes registered or extended. */
    bytes: number;
    /** The longest term bought, in epochs. 0 for a certification. */
    epochs: number;
    /** The Walrus calls it makes, in order. */
    calls: string[];
}
export type SponsorVerdict = {
    ok: true;
    spends: SponsorSpend;
} | {
    ok: false;
    code: SponsorRefusal;
    reason: string;
};
export type SponsorRefusal = "SPONSOR_NOT_A_TRANSACTION" | "SPONSOR_SENDER" | "SPONSOR_GAS_OWNER" | "SPONSOR_GAS_BUDGET" | "SPONSOR_INPUT" | "SPONSOR_COMMAND" | "SPONSOR_CALL" | "SPONSOR_NETWORK" | "SPONSOR_TRANSFER" | "SPONSOR_UNBOUNDED" | "SPONSOR_STORAGE" | "SPONSOR_SIZE" | "SPONSOR_EPOCHS" | "SPONSOR_WAL" | "SPONSOR_SUI" | "SPONSOR_EMPTY";
/** Judge one transaction against a policy. Never throws for a refusal: the verdict says it. */
export declare function judgeSponsored(bytes: Uint8Array | string, policy: SponsorPolicy, facts: SponsorFacts): Promise<SponsorVerdict>;
