import { type ExtendReads, type SignExtension } from "../extend-plan.ts";
import type { StandingTipInput } from "../standing-tip.ts";
export interface ExtendOptions {
    server?: string | undefined;
    network?: string | undefined;
    json?: boolean;
    write?: (line: string) => void;
    /** How many of the storage network's epochs to add. Default `DEFAULT_EXTEND_EPOCHS`. */
    epochs?: string | number | undefined;
    /** Say what it would cost and stop. ⛔ Nothing is signed and no key is touched. */
    dryRun?: boolean;
    /** Extend a file that is not near its deadline. Said out loud because it spends money early. */
    yes?: boolean;
    /**
     * The chain reads.
     *
     * ⚠ A SEAM, NOT AN OPTION — no flag reaches it. See `ExtendReads`: a test that talked to a live
     *   storage network could not run offline and could never be asked to be at its own ceiling.
     */
    readChain?: (network: string) => Promise<ExtendReads> | ExtendReads;
    /**
     * The signature.
     *
     * ⛔ SEPARATE FROM THE READS SO A TEST CAN PROVE THE THING THAT MATTERS: that `--dry-run` and a
     *    missing agreement both stop before anything reaches this.
     */
    sign?: SignExtension;
    /** The instant to measure against. Passed in so one run reports one moment. */
    now?: number;
    /** ⚠ SEAMS, NOT OPTIONS — the standing tip's own read and signature. No flag reaches them. */
    tip?: Pick<StandingTipInput, "readDonation" | "sign">;
}
export declare function extend(target: string | undefined, options?: ExtendOptions): Promise<number>;
