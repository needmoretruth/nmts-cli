import { type DonationConfig } from "./commands/wallet-donate.ts";
import type { Network } from "./network.ts";
import type { SignTransfer } from "./wallet-sign.ts";
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
    say: (line: string) => void;
    /** Seams for tests. */
    readDonation?: (server: string) => Promise<DonationConfig>;
    sign?: SignTransfer;
}
/** Send the standing share, if there is one. Returns what happened; never throws past a payment. */
export declare function standingTipAfter(input: StandingTipInput): Promise<"none" | "sent" | "failed">;
