// `nmts tip [percent | off]` — the standing share of every storage payment sent to the developer
// as a gift (owner 2026-09-06). Read with no argument; set with a percent; `off` is 0.
//
// ⛔ IT LIVES IN THE SEALED FILE LIST, like `padding`: the server must not learn it, and it follows
//    the account, so the browser and every machine send the same share. 0 is spelled as absence.
//
// ⛔ THE AGREEMENT IS ASKED ONCE, AND ONLY WHEN RAISING FROM 0. Setting any share above 0 needs the
//    `donate` unlock — that unlock's text IS the gift terms (voluntary · nothing in return · not
//    refundable · the published address · visible on the chain) — and the first such setting
//    writes the agreement's instant into the list, which the browser reads as the same agreement.
//    After that, changing the share asks nothing. Above 10 % the run confirms once more, in words,
//    that this share of EVERY payment is meant, permanently: at a terminal, or with `--yes`.
//
// ⛔ NOTHING IS SENT HERE. The sending happens after each payment (`standing-tip.ts`), without a
//    question, because this is the person's standing choice.

import { requireConsent } from "../consent.ts";
import { NmtsError } from "../errors.ts";
import { readFileList } from "../manifest.ts";
import { applyManyToList } from "../manifest-write.ts";
import { BINARY_NAME } from "../product.ts";
import { promptLine, stdinIsATerminal } from "../prompt.ts";
import { openSession } from "../session.ts";
import { TIP_DIAL_MAX_TENTHS, needsExtraConfirm, percentText, tenthsFromPercent } from "../shared/lib/wallet/tip.ts";

export interface TipOptions {
  server?: string | undefined;
  network?: string | undefined;
  json?: boolean;
  yes?: boolean;
  write?: (line: string) => void;
  /** Injected in tests: answers the one confirmation above the dial's end. */
  readLine?: ((question: string) => Promise<string>) | undefined;
  now?: number;
}

export async function tip(wanted: string | undefined, options: TipOptions = {}): Promise<number> {
  const say = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const session = await openSession({ server: options.server, network: options.network });
  const list = await readFileList(session.server, session.apiKey, session.code, session.accountId);
  const current = list.manifest?.settings?.tipTenths ?? 0;
  const consentAt = list.manifest?.settings?.tipConsentAt;

  if (wanted === undefined || wanted === "") {
    if (options.json === true) {
      say(JSON.stringify({ tipPercent: Number(percentText(current)), tipTenths: current, agreedAt: consentAt === undefined ? null : new Date(consentAt).toISOString() }));
      return 0;
    }
    say(
      current > 0
        ? `Every storage payment sends ${percentText(current)} % of what it paid to the developer, as a gift, in WAL — without asking.`
        : `No standing gift: 0 % of each storage payment goes to the developer.`,
    );
    say(`  Set one: \`${BINARY_NAME} tip 2.5\` (in steps of 0.1 %, the dial ends at 10 %). Stop it: \`${BINARY_NAME} tip off\`.`);
    if (consentAt !== undefined) say(`  The gift terms were agreed to on ${new Date(consentAt).toISOString().slice(0, 10)}.`);
    return 0;
  }

  const tenths = wanted === "off" || wanted === "0" ? 0 : tenthsFromPercent(Number(wanted));
  if (wanted !== "off" && !/^\d+(\.\d+)?$/.test(wanted)) {
    throw new NmtsError(`\`${BINARY_NAME} tip\` takes a percent (2.5) or off.`, { exitCode: 2 });
  }
  if (list.manifest === null) {
    throw new NmtsError(`This account has no file list yet; the setting lives in the list, and there is nothing to write it into.`, {
      exitCode: 4,
      nextStep: `Upload once (\`${BINARY_NAME} put\`) and set it after.`,
    });
  }
  // ⛔ THE AGREEMENT — the `donate` unlock — stands between 0 and anything above it, once per machine.
  if (tenths > 0) requireConsent("donate");
  if (needsExtraConfirm(tenths) && options.yes !== true) {
    const ask = options.readLine ?? promptLine;
    if (options.readLine === undefined && !stdinIsATerminal()) {
      throw new NmtsError(`A share above ${percentText(TIP_DIAL_MAX_TENTHS)} % is confirmed by a person.`, {
        exitCode: 5,
        nextStep: `Ask them, then run the same command with --yes.`,
      });
    }
    const answer = (await ask(`Send ${percentText(tenths)} % of EVERY storage payment to the developer, permanently, until you change it? [y/N] `)).trim();
    if (answer !== "y" && answer !== "Y") {
      say(`Nothing changed.`);
      return 1;
    }
  }
  const patch: { tipTenths: number; tipConsentAt?: number } = { tipTenths: tenths };
  if (tenths > 0 && consentAt === undefined) patch.tipConsentAt = options.now ?? Date.now();
  const result = await applyManyToList(session, () => [], patch);
  if (options.json === true) {
    say(JSON.stringify({ tipPercent: Number(percentText(tenths)), tipTenths: tenths, changed: result.changed }));
    return 0;
  }
  if (!result.changed) say(`Already ${tenths === 0 ? "off" : `${percentText(tenths)} %`}. Nothing changed.`);
  else if (tenths === 0) say(`Standing gift set to 0 %: nothing more is sent after a payment.`);
  else say(`Standing gift set: every storage payment now sends ${percentText(tenths)} % of what it paid to the developer, in WAL, without asking.`);
  say(`  Thank you.`);
  return 0;
}
