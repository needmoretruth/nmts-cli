// The standing tip: the share of a storage payment the person set once, sent to the developer
// after every wallet payment without a question (owner 2026-09-06 · the tier table calls it none).
//
// ⛔ IT IS THE PERSON'S STANDING CHOICE, READ FROM THE SEALED FILE LIST — the same place the
//    browser writes it — and it exists only where two things are both true: a share above 0, and
//    the gift terms agreed to. Nothing here asks; `nmts tip` is where the asking happened.
//
// ⛔ A SECOND, SEPARATE TRANSACTION, after the payment is done, never inside it: a gift that fails
//    must not fail the storage purchase. A failure here is said and does not change the exit code
//    of the payment — the storage is bought either way.
//
// ⛔ OUTSIDE THE WALLET UNLOCK AND ITS CEILING, like every gift (`wallet donate`): the unlock is what
//    lets a PROGRAM sign for storage; a tip is the person's own standing instruction.

import { request } from "./api.ts";
import { asDonationConfig, type DonationConfig } from "./commands/wallet-donate.ts";
import type { Network } from "./network.ts";
import { isValidSuiAddress } from "./shared/lib/wallet/send-rules.ts";
import { percentText, tipFromTenths } from "./shared/lib/wallet/tip.ts";
import { coinAmount, walCoinType } from "./wallet.ts";
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
export const TIP_ADDRESS: Readonly<Record<Network, string>> = {
  mainnet: "0x5414efbeeab97a210e3ad48e458056fd62bcfc0d99ea78b632b813a6540c09c1",
  testnet: "0x5414efbeeab97a210e3ad48e458056fd62bcfc0d99ea78b632b813a6540c09c1",
};

/** The owner's thank-you, in both languages, printed after every gift whatever its size. */
export const THANKS_EN = "Thank you for your gift. Honestly, I did not know anyone would. Thank you.";
export const THANKS_KO = "후원해 주셔서 정말 감사합니다. 사실 저는 후원해 줄 사람이 있을 거라고도 몰랐습니다. 정말 감사합니다."; // shown in Korean

export interface StandingTipInput {
  server: string;
  network: Network;
  code: string;
  /** The sealed list's settings, as read for the payment. */
  settings: { tipTenths?: number; tipConsentAt?: number } | undefined;
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
export async function standingTipAfter(input: StandingTipInput): Promise<"none" | "sent" | "failed"> {
  const tenths = input.settings?.tipTenths ?? 0;
  if (tenths <= 0 || input.settings?.tipConsentAt === undefined || input.paidWalFrost <= 0n) return "none";
  const amount = tipFromTenths(input.paidWalFrost, tenths);
  if (amount <= 0n) return "none";
  try {
    const config = await (input.readDonation ?? (async (base: string) => asDonationConfig(await request(base, "/api/donation"))))(input.server);
    if (!config.sendEnabled || !config.walEnabled || !isValidSuiAddress(config.devAddress)) {
      input.say(`  Your standing ${percentText(tenths)} % gift was not sent: gifts in WAL are not open right now.`);
      return "failed";
    }
    // ⛔ THE ONE CHECK THAT COSTS NOTHING AND CLOSES THE HOLE. Everything above asks whether a gift
    //    may be sent; this asks whether it is going where the person meant. A mismatch is refused
    //    rather than reported afterwards — money does not come back from a wrong address.
    if (config.devAddress !== TIP_ADDRESS[input.network] && input.trustServerAddress !== true) {
      input.say(
        `  Your standing ${percentText(tenths)} % gift was not sent: this server named a different ` +
          `receiving address than the one built into this tool for ${input.network}.`,
      );
      input.say(
        `  Nothing was signed. On a server you run yourself, --trust-server-tip-address sends to ` +
          `the address that server names.`,
      );
      return "failed";
    }
    const sign = input.sign ?? (await import("./wallet-sign.ts")).signTransfer;
    const digest = await sign({
      network: input.network,
      code: input.code,
      wallet: input.wallet,
      shape: { coin: "WAL", amountBaseUnits: amount, destination: config.devAddress, walType: walCoinType(input.network) },
    });
    input.say(`  Your standing ${percentText(tenths)} % gift — ${coinAmount(amount)} WAL — went to the developer. Transaction ${digest}`);
    input.say(`  ${THANKS_EN}`);
    input.say(`  ${THANKS_KO}`);
    return "sent";
  } catch (error) {
    input.say(`  Your standing ${percentText(tenths)} % gift was not sent: ${error instanceof Error ? error.message : String(error)}`);
    input.say(`  The storage payment above is unaffected.`);
    return "failed";
  }
}
