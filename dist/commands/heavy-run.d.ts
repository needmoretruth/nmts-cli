import { type CryptoGlue } from "../crypto.ts";
import { type HeavyCommitted, type HeavyFile } from "../heavy-upload.ts";
import type { Network } from "../network.ts";
import type { Progress } from "../progress.ts";
import type { Session } from "../session.ts";
import type { OnCollision } from "../collision.ts";
import type { PaddingRule } from "../shared/lib/crypto/size-padding.ts";
import { type AccountSettings } from "../shared/lib/drive/manifest-settings.ts";
import { type HeavyFlags } from "./put-payer.ts";
export type HeavyPayer = "credits" | "wallet" | "evm";
/** What a Heavy command line may carry. */
export interface HeavyCommandOptions extends HeavyFlags {
    pay?: string | undefined;
    epochs?: string | number | undefined;
    storage?: string | undefined;
    from?: string | undefined;
    deposit?: string | number | undefined;
    partSize?: string | number | undefined;
    wallet?: string | undefined;
    trustServerTipAddress?: boolean;
    thumbnail?: boolean;
    thumbnailFile?: string | undefined;
    dryRun?: boolean;
    json?: boolean;
    /** The instant the wallet agreement is measured against. */
    now?: number;
}
export declare function heavyPayerOf(pay: string | undefined): HeavyPayer;
/** Every option that means nothing on this payer, refused before a file is measured. */
export declare function refuseHeavyClashes(options: HeavyCommandOptions, payer: HeavyPayer): void;
/** `--days`: 1..365, default 28 — the term a credit buys. */
export declare function termDaysOf(raw: string | undefined): number;
export interface HeavyRunContext {
    session: Session;
    network: Network;
    crypt: CryptoGlue;
    rule: PaddingRule;
    settings: AccountSettings | undefined;
    say: (line: string) => void;
    json: boolean;
    progress: Progress;
}
/** What the run did, for the caller's printing and `--json`. */
export interface HeavyRunReport {
    files: HeavyCommitted[];
    facts: Record<string, unknown>;
}
/** The dry run: what is known without opening an order or touching a chain. */
export declare function heavyDryRun(files: readonly HeavyFile[], rule: PaddingRule, payer: HeavyPayer): Record<string, unknown>;
/** Upload these files to NMTS Heavy on this payer, and commit them. The caller writes the list. */
export declare function runHeavy(ctx: HeavyRunContext, files: readonly HeavyFile[], payer: HeavyPayer, options: HeavyCommandOptions): Promise<HeavyRunReport>;
/** A server refusal as itself; any other stop of the runner in the Heavy words. */
export declare function heavyFailure(error: unknown): unknown;
/** Write each committed file into the sealed list; a displaced one goes to the server's trash last. */
export declare function recordHeavy(session: Session, done: HeavyCommitted, onCollision: OnCollision | undefined): Promise<{
    name: string;
    replaced: string | null;
    seq: number;
}>;
