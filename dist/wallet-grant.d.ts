export declare const WALLET_SCOPES: readonly ["storage", "all"];
export type WalletScope = (typeof WALLET_SCOPES)[number];
/** What a signature is for. `donate` is deliberately not here: no grant reaches a gift. */
export type WalletAction = "extend" | "seal" | "reshape" | "exchange" | "send" | "give";
/** The ceiling on any grant's length. The browser's standing approval has the same one. */
export declare const MAX_GRANT_DAYS = 30;
export interface WalletGrant {
    scope: WalletScope;
    grantedAt: string;
    expiresAt: string;
    byVersion: string;
    /** Ceilings in base units, as strings (a JSON number would round them). `null` = no ceiling. */
    capWalFrost: string | null;
    capSuiMist: string | null;
    /** What this tool has signed away under this grant, in base units. */
    spentWalFrost: string;
    spentSuiMist: string;
}
export interface Spend {
    walFrost: bigint;
    suiMist: bigint;
}
/** A decimal coin amount ("1.25") as base units. Nine decimals, like the chain. */
export declare function parseCoinAmount(text: string, what: string): bigint;
export declare function scopeCovers(scope: WalletScope, action: WalletAction): boolean;
/** Turn what was typed into a grant, or refuse with the line to correct. Nothing is written. */
export declare function parseWalletGrant(input: {
    days?: string | undefined;
    until?: string | undefined;
    scope?: string | undefined;
    capWal?: string | undefined;
    capSui?: string | undefined;
}, now: Date, version: string): WalletGrant;
/** The grant on this machine, or null — an older bare-date record, or a malformed one, is null. */
export declare function readWalletGrant(): WalletGrant | null;
export declare function writeWalletGrant(grant: WalletGrant): void;
export type GrantState = "none" | "expired" | "active";
export declare function walletGrantState(grant: WalletGrant | null, now: Date): GrantState;
/** What is left under a ceiling, or null when there is none. */
export declare function roomLeft(cap: string | null, spent: string): bigint | null;
/**
 * Stop unless an active grant covers this signature and its amount, and say what would.
 *
 * ⛔ THE MESSAGE IS THE PRODUCT HERE, as with every other agreement: what happens, what can go
 *    wrong, what is not covered, and the one command that agrees — and, new for this key, the
 *    three things the grant carries.
 */
export declare function requireWalletGrant(action: WalletAction, spend: Spend, now: Date): WalletGrant;
/** Add what was just signed to the grant's ledger. Called after a signature, never before. */
export declare function recordWalletSpend(spend: Spend): void;
