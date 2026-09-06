import { type CryptoGlue } from "./crypto.ts";
import type { SourceItem } from "./rebuild.ts";
import { type PairVerdict } from "./shared/lib/drive/rebuild-verify.ts";
import type { ReadOptions } from "./walrus.ts";
export interface KeyCheckInput {
    server: string;
    apiKey: string;
    /** The account code, used once to derive the data key that opens the wrapped file keys. */
    accountCode: string;
    /** Which chain's aggregators hold the bytes — `mainnet` or `testnet`. */
    chain: string;
    read?: ReadOptions | undefined;
    crypt: CryptoGlue;
}
/**
 * A checker for this account, plus the way to forget the key it holds.
 *
 * ⛔ THE DATA KEY IS DERIVED ONCE, NOT PER FILE. Deriving it is a 64 MiB Argon2id pass; doing that
 *    per row would turn a thousand-file account into an hour of key derivation. It is held for the
 *    length of one rebuild and wiped by `done()`, which every path out of the caller reaches.
 */
export interface AccountKeyCheck {
    check(item: SourceItem): Promise<PairVerdict>;
    done(): void;
}
export declare function accountKeyCheck(input: KeyCheckInput): AccountKeyCheck;
