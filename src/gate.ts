// The one place a tier meets a mode: refuse, ask, or wave through.
//
// ⛔ EVERY COMMAND PASSES HERE BEFORE IT RUNS (`main.ts`), with the act `risk.ts` names for its
//    command line. What it decides, in this order and nowhere else:
//      1. none runs.
//      2. skip-permissions runs everything — an ultra-high act with a written --reason, kept in the
//         run log.
//      3. ultra-high: a person at the terminal (mode default) may go on to the command's own typed
//         sentence; an auto mode is refused, unlocked or not.
//      4. high sits behind an unlock. Locked is refused with the one command that unlocks it, which
//         only a person at a terminal can run.
//      5. A yes is needed for high in every mode, and for low and medium in default. An act that
//         asks itself is told so and asks in its own words; anything else is asked here — y/N at a
//         terminal, or exit 5 with the sentence an agent shows the person, answered by --yes.
//
// ⛔ WHAT `--yes` PROVES: nothing. No command-line tool can tell whether a person or a program typed
//    it. The instructions say an agent passes it only after the person said yes; this file makes the
//    stop impossible to miss and the question the same every time. Saying more would be a claim.

import { currentMode, type Autonomy } from "./autonomy.ts";
import type { ParsedArgs } from "./args.ts";
import { CONSENTS, isGranted } from "./consent.ts";
import { NmtsError } from "./errors.ts";
import { BINARY_NAME } from "./product.ts";
import { promptLine, stdinIsATerminal } from "./prompt.ts";
import { ACTS, type ActId } from "./risk.ts";

export interface GateIo {
  write?: ((line: string) => void) | undefined;
  /** Injected in tests: answers the y/N. Its presence stands in for a terminal. */
  readLine?: ((question: string) => Promise<string>) | undefined;
  now?: (() => Date) | undefined;
}

export interface Passage {
  /** The command must still get a yes in its own words — a review and --yes, a typed sentence. */
  ask: boolean;
  mode: Autonomy;
}

/** Whether the unlock behind an act is open right now. */
export async function unlocked(key: keyof typeof CONSENTS, now: Date): Promise<boolean> {
  if (key === "wallet") {
    // ⚠ Loaded here, not at the top: the wallet module reaches the chain SDK, and this file
    //    runs on every command (`check:cli-startup`).
    const { readWalletGrant, walletGrantState } = await import("./wallet-grant.ts");
    return walletGrantState(readWalletGrant(), now) === "active";
  }
  return isGranted(key);
}

export async function gate(act: ActId, args: ParsedArgs, io: GateIo = {}): Promise<Passage> {
  const a = ACTS[act];
  const mode = currentMode();
  const now = io.now ?? (() => new Date());
  if (a.tier === "none") return { ask: false, mode };

  if (mode === "skip-permissions") {
    if (a.tier === "ultra-high" && (args.reason === undefined || args.reason.trim() === "")) {
      throw new NmtsError(`${a.what} This is permanent, and skip-permissions still wants the reason written down.`, {
        exitCode: 5,
        nextStep:
          `Think it through first — is this really what the person would want done right now, and ` +
          `why? Then run the same command with --reason "<that, in a sentence>". The reason is kept ` +
          `in this machine's run log.`,
      });
    }
    return { ask: false, mode };
  }
  if (a.tier === "ultra-high") {
    if (mode !== "default") {
      throw new NmtsError(`${a.what} Not from an agent, in any auto mode.`, {
        exitCode: 5,
        nextStep:
          `A person does this at the terminal (mode default). Tell them what you wanted and stop; ` +
          `there is no unlock for it.`,
      });
    }
    return { ask: true, mode };
  }
  if ("lock" in a && !(await unlocked(a.lock, now()))) {
    const c = CONSENTS[a.lock];
    throw new NmtsError(`${a.what} This is locked until a person unlocks it on this machine.`, {
      exitCode: 5,
      nextStep: [
        c.risk,
        "",
        c.limit,
        "",
        `To unlock, at a terminal, once:  ${BINARY_NAME} unlock ${a.lock}`,
        `To see what is unlocked:         ${BINARY_NAME} unlock`,
        "",
        `⛔ If a program is reading this on somebody's behalf: show it to them and let them decide.`,
        `   Do not run the unlock command yourself.`,
      ].join("\n"),
    });
  }
  const needsYes = a.tier === "high" ? !("standing" in a) : mode === "default";
  if (!needsYes) return { ask: false, mode };
  if ("asksItself" in a) return { ask: !args.yes, mode };
  if (args.yes) return { ask: false, mode };

  const say = io.write ?? ((line: string) => process.stderr.write(`${line}\n`));
  if (io.readLine !== undefined || stdinIsATerminal()) {
    const ask = io.readLine ?? promptLine;
    say(a.what ?? act);
    const answer = (await ask(`Go ahead? [y/N] `)).trim();
    if (answer === "y" || answer === "Y") return { ask: false, mode };
    throw new NmtsError(`Nothing was done.`, { exitCode: 1, nextStep: null });
  }
  throw new NmtsError(a.what ?? act, {
    exitCode: 5,
    nextStep:
      `This needs the person's yes. Tell them, in plain words, what this does and what it costs; ` +
      `if they say yes, run the same command with --yes. Nothing was done.`,
  });
}
