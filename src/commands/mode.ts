// `nmts mode` — how much an agent driving this tool may decide without asking.
//
// ⛔ A PERSON SWITCHES IT, AT A TERMINAL. Turning a mode on refuses when stdin is not a terminal —
//    the way an agent's subprocess usually arrives — prints the whole explanation first, and takes
//    one answer: y for the two auto modes, a typed sentence for skip-permissions. Turning it off is
//    one line from anywhere. Short for the person, closed to the program: that is the shape the owner
//    asked for (2026-09-06).
//
// ⛔ `nmts mode explain <mode>` PRINTS THE EXPLANATION AND CHANGES NOTHING. It exists so an agent that
//    recommends a mode can show the person exactly what it is, rather than its own summary.

import {
  AUTONOMY_MODES,
  MODE_MEANS,
  SKIP_SENTENCE,
  currentMode,
  explain,
  modeFromStored,
  setAt,
  setMode,
  type Autonomy,
} from "../autonomy.ts";
import { NmtsError } from "../errors.ts";
import { BINARY_NAME, VERSION } from "../product.ts";
import { promptLine, stdinIsATerminal } from "../prompt.ts";

export interface ModeOptions {
  json?: boolean;
  write?: (line: string) => void;
  now?: () => Date;
  /** Injected in tests: answers the one question. Its presence also stands in for a terminal. */
  readLine?: ((question: string) => Promise<string>) | undefined;
}

/** A name a person may type, including the two older spellings. */
function wantedMode(raw: string): Autonomy | null {
  if (raw === "off" || raw === "auto") return modeFromStored(raw);
  return (AUTONOMY_MODES as readonly string[]).includes(raw) ? (raw as Autonomy) : null;
}

export async function mode(
  wanted: string | undefined,
  target: string | undefined,
  options: ModeOptions = {},
): Promise<number> {
  const say = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const now = options.now ?? (() => new Date());

  if (wanted === undefined || wanted === "") {
    const at = currentMode();
    if (options.json === true) {
      say(JSON.stringify({ mode: at, setAt: setAt(), means: MODE_MEANS[at] }));
      return 0;
    }
    say(`${at} — ${MODE_MEANS[at]}`);
    for (const other of AUTONOMY_MODES) {
      if (other !== at) say(`${other} — ${MODE_MEANS[other]}`);
    }
    say(`Change it, at a terminal: ${BINARY_NAME} mode <${AUTONOMY_MODES.join("|")}>`);
    say(`Read one in full first:    ${BINARY_NAME} mode explain <mode>`);
    return 0;
  }

  if (wanted === "explain") {
    const which = target === undefined ? null : wantedMode(target);
    if (which === null) {
      throw new NmtsError(`Say which mode to explain.`, { exitCode: 2, nextStep: `One of: ${AUTONOMY_MODES.join(" · ")}` });
    }
    for (const line of explain(which)) say(line);
    return 0;
  }

  const next = wantedMode(wanted);
  if (next === null) {
    throw new NmtsError(`There is no mode called "${wanted}".`, {
      exitCode: 2,
      nextStep: `One of: ${AUTONOMY_MODES.join(" · ")}`,
    });
  }

  // ⛔ OFF IS ONE LINE FROM ANYWHERE. Making the safe direction harder than the risky one is how
  //    somebody leaves it on.
  if (next === "default") {
    setMode("default", VERSION, now());
    say(`default — ${MODE_MEANS.default}`);
    return 0;
  }

  if (options.readLine === undefined && !stdinIsATerminal()) {
    throw new NmtsError(`A person switches modes, at a terminal — stdin here is not one.`, {
      exitCode: 5,
      nextStep:
        `If you are an agent: do not switch modes. You may recommend one — show the person ` +
        `\`${BINARY_NAME} mode explain ${next}\` in full and let them decide.`,
    });
  }
  const ask = options.readLine ?? promptLine;
  for (const line of explain(next)) say(line);
  say(``);
  if (next === "skip-permissions") {
    const typed = (await ask(`Type exactly: ${SKIP_SENTENCE}\n> `)).trim();
    if (typed !== SKIP_SENTENCE) {
      say(`Nothing was changed.`);
      return 1;
    }
  } else {
    const answer = (await ask(`Turn ${next} on? [y/N] `)).trim();
    if (answer !== "y" && answer !== "Y") {
      say(`Nothing was changed.`);
      return 1;
    }
  }
  setMode(next, VERSION, now());
  say(`${next} — ${MODE_MEANS[next]}`);
  return 0;
}
