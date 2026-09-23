import { type DonationConfig } from "./commands/wallet-donate.ts";
import type { Network } from "./network.ts";
import type { SignTransfer } from "./wallet-sign.ts";
/**
 * Where a standing gift goes, per network — written into the build, not asked for.
 *
 * ⛔ THE RECEIVING ADDRESS IS NOT THE SERVER'S TO CHOOSE. Until now it was whatever `--server`
 *    answered and only its SHAPE was checked, so one wrong or hostile server collected every
 *    standing gift from every machine pointed at it — silently, because a well-formed address is
 *    indistinguishable from the right one. The browser never had that hole: its address comes from
 *    the build the owner ships. This is that same value, and the server's answer is held against
 *    it below.
 *
 * ⚠ ONE STRING UNDER TWO NETWORKS, and that is a fact rather than a placeholder: a Sui address
 *   belongs to a keypair, not to a network, so the owner's wallet is the same address on both. The
 *   table is per network so that the day one of them moves there is a line to change.
 *
 * ⛔ IT IS A PUBLIC VALUE, NOT A SECRET. An address is what you hand out to be paid — the site
 *    prints this one on the donation card — and the key behind it is nowhere near this package.
 */
export declare const TIP_ADDRESS: Readonly<Record<Network, string>>;
/** The owner's thank-you, in both languages, printed after every gift whatever its size. */
export declare const THANKS_EN = "Thank you for your gift. Honestly, I did not know anyone would. Thank you.";
export declare const THANKS_KO = "\uD6C4\uC6D0\uD574 \uC8FC\uC154\uC11C \uC815\uB9D0 \uAC10\uC0AC\uD569\uB2C8\uB2E4. \uC0AC\uC2E4 \uC800\uB294 \uD6C4\uC6D0\uD574 \uC904 \uC0AC\uB78C\uC774 \uC788\uC744 \uAC70\uB77C\uACE0\uB3C4 \uBAB0\uB790\uC2B5\uB2C8\uB2E4. \uC815\uB9D0 \uAC10\uC0AC\uD569\uB2C8\uB2E4.";
export interface StandingTipInput {
    server: string;
    network: Network;
    code: string;
    /** The sealed list's settings, as read for the payment. */
    settings: {
        tipTenths?: number;
        tipConsentAt?: number;
    } | undefined;
    /** What was just paid for storage, in WAL base units. */
    paidWalFrost: bigint;
    /** ⛔ The wallet the storage was just paid from — a gift from a different one would come out of
     *  a balance nobody was looking at, and the payment above named this one. */
    wallet: number;
    say: (line: string) => void;
    /**
     * Send to the address THIS SERVER names, even when it is not the one pinned above.
     *
     * ⛔ OFF BY DEFAULT AND IT HAS TO STAY THAT WAY. It exists for somebody running their own NMTS
     *    server, whose developer address is their own and is not ours; switching it on for a server
     *    you do not run hands that server every standing gift this machine sends.
     */
    trustServerAddress?: boolean;
    /** Seams for tests. */
    readDonation?: (server: string) => Promise<DonationConfig>;
    sign?: SignTransfer;
}
/** Send the standing share, if there is one. Returns what happened; never throws past a payment. */
export declare function standingTipAfter(input: StandingTipInput): Promise<"none" | "sent" | "failed">;
