// `nmts mode` — how much an agent driving this tool may decide without asking.
//
// ⛔ IT IS A COMMAND, FOR THE SAME REASON CONSENT IS. A question asked in the middle of another
//    command cannot be answered by a container, a build step, or an agent's subprocess. A command
//    can, its answer is recorded with a date, and it can be looked at afterwards.
//
// ⛔ TURNING ONE ON TAKES A FLAG THAT SAYS WHAT IT IS. `nmts mode auto` alone prints what the mode
//    means and stops; adding the flag is the sentence nobody types by accident.

import {
  AUTONOMY_MODES,
  MODE_MEANS,
  RISK_FLAG,
  currentMode,
  setAt,
  setMode,
  type Autonomy,
} from "../autonomy.ts";
import { NmtsError } from "../errors.ts";
import { BINARY_NAME, VERSION } from "../product.ts";

export interface ModeOptions {
  json?: boolean;
  accepted?: boolean;
  write?: (line: string) => void;
  now?: () => Date;
}

function isMode(value: string): value is Autonomy {
  return (AUTONOMY_MODES as readonly string[]).includes(value);
}

export function mode(wanted: string | undefined, options: ModeOptions = {}): number {
  const say = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const now = options.now ?? (() => new Date());

  if (wanted === undefined || wanted === "") {
    const at = currentMode();
    if (options.json === true) {
      say(JSON.stringify({ mode: at, setAt: setAt(), means: MODE_MEANS[at] }));
      return 0;
    }
    say(`${at} — ${MODE_MEANS[at]}`);
    // ⛔ The way to change it is said HERE. Listing what exists without saying how to pick one
    //    sends the reader back to the help text and leaves an agent to guess.
    for (const other of AUTONOMY_MODES) {
      if (other !== at) say(`${other} — ${MODE_MEANS[other]}`);
    }
    say(`Change it: ${BINARY_NAME} mode <${AUTONOMY_MODES.join("|")}> ${RISK_FLAG}`);
    return 0;
  }

  if (!isMode(wanted)) {
    throw new NmtsError(`There is no mode called "${wanted}".`, {
      exitCode: 2,
      nextStep: `One of: ${AUTONOMY_MODES.join(" · ")}`,
    });
  }

  // ⛔ Turning one OFF never needs the flag. Making the safe direction harder than the risky one
  //    is how somebody leaves it on.
  if (wanted !== "off" && options.accepted !== true) {
    throw new NmtsError(MODE_MEANS[wanted], {
      exitCode: 2,
      nextStep: [
        "You bear what an agent does with your files and your credits while this is on.",
        `Turn it on: ${BINARY_NAME} mode ${wanted} ${RISK_FLAG}`,
      ].join("\n  "),
    });
  }

  setMode(wanted, VERSION, now());
  say(wanted === "off" ? `off — ${MODE_MEANS.off}` : `${wanted} — ${MODE_MEANS[wanted]}`);
  return 0;
}
