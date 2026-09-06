// How much an agent driving this tool may decide on its own — the four modes.
//
// ⛔ THIS IS A DIFFERENT AXIS FROM UNLOCKING, and mixing the two would make both harder to reason
//    about. An unlock says "this machine's owner opened this capability" -- it is about WHAT the
//    tool may do, it is recorded, and it stands until it is locked again. A mode says "an agent
//    driving this tool may decide for me" -- it is about WHO CHOOSES, and it opens nothing that is
//    locked. They are stored in different files for that reason.
//
// ⛔ THE FOUR, AND WHAT EACH ONE CHANGES (owner, 2026-09-06). Every act this tool performs carries a
//    risk tier (`risk.ts`: none · low · medium · high · ultra-high), and a mode decides which tiers
//    go ahead without a person:
//      default          a person is at the terminal. none runs; everything else is asked about;
//                       high is locked until unlocked; ultra-high takes a typed sentence.
//      auto-low         the agent judges whether the person asked for it, or whether it is a
//                       reasonable thing to do unasked. none and low run; medium is the agent's
//                       call (the code does not stop it, the instructions say to ask); high is
//                       asked about AND locked; ultra-high never.
//      auto-high        the same limits in code as auto-low. The instructions ask the agent to
//                       reason more autonomously — for a model the person judges able to keep
//                       itself safe. What differs is the instructions, not the tool.
//      skip-permissions the person has left the chair. Nothing is refused and nothing asks;
//                       ultra-high still demands a written reason, kept in the run log.
//
// ⛔ A MODE IS SWITCHED AT A TERMINAL, BY A PERSON, and that is the lock: the command refuses when
//    stdin is not a terminal, which is how an agent's subprocess usually arrives. It is not a
//    perfect lock — a pseudo-terminal can be made — so the instructions say the same thing in
//    words: an agent may RECOMMEND a mode, with the full explanation, and never turn one on.
//    Turning one OFF (`nmts mode default`) needs no terminal: the safe direction is never harder.
//
// ⚠ AND WHAT NO COMMAND-LINE TOOL CAN DO: tell whether a person or a program typed this. The
//   protection here is that the choice is explicit, written down, dated, and announced on every
//   run that uses it -- not that it cannot be automated.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";

import { configDir, modesAreEnforced } from "./credentials.ts";

/** What an agent may decide without asking. */
export type Autonomy = "default" | "auto-low" | "auto-high" | "skip-permissions";

export const AUTONOMY_MODES: readonly Autonomy[] = ["default", "auto-low", "auto-high", "skip-permissions"];

/** What each mode means, in the words the tool prints. One line each, no more. */
export const MODE_MEANS: Readonly<Record<Autonomy, string>> = {
  default: "A person is asked before anything but reading and tidying. This is the default.",
  "auto-low":
    "The agent decides whether you asked for it, or whether it is fine to do unasked, and goes ahead " +
    "with low and medium acts. High acts still ask and stay locked; irreversible ones are refused.",
  "auto-high":
    "Like auto-low, but the agent is told to reason for itself more — for a model you trust to keep " +
    "itself safe. The tool refuses exactly what auto-low refuses.",
  "skip-permissions":
    "Nothing asks and nothing is refused. You have left the chair. Irreversible acts still need a " +
    "written reason, kept in the run log.",
};

/**
 * The whole explanation of one mode — what it is, what can go wrong, what is gained, and the way
 * out. ⛔ AN AGENT THAT RECOMMENDS A MODE SHOWS THIS TEXT, whole, to the person (AGENTS.md).
 */
export function explain(mode: Autonomy): string[] {
  const off = `Turn it off at any time: \`nmts mode default\`.`;
  switch (mode) {
    case "default":
      return [
        `default — ${MODE_MEANS.default}`,
        `What happens: reading, downloading, listing, moving, renaming, labelling run at once. Anything`,
        `that changes or spends is asked about (y/N here, or --yes from an agent that asked you).`,
        `High acts — sharing, signing with the wallet, signing devices out, exposing the code — are`,
        `locked until you unlock them (\`nmts unlock\`). Erasing the account or files takes a typed sentence.`,
        `Risk: the smallest. Cost: an agent stops for you often.`,
      ];
    case "auto-low":
      return [
        `auto-low — ${MODE_MEANS["auto-low"]}`,
        `What happens: the agent runs reads, tidying and reversible changes without asking, and may run`,
        `medium acts — uploads that spend credits within the server's daily ceiling, making an API key,`,
        `publishing your public code — when it judges you asked for them or would want them. High acts`,
        `(sharing, wallet signing, signing devices out) are still asked about and stay locked until you`,
        `unlock them. Erasing the account or files is refused however it is asked.`,
        `Risk: credits can be spent and metadata changed without a question each time. What you gain:`,
        `an agent that finishes a task instead of stopping at every step.`,
        off,
      ];
    case "auto-high":
      return [
        `auto-high — ${MODE_MEANS["auto-high"]}`,
        `What happens: the tool refuses exactly what auto-low refuses; what changes is the instruction`,
        `the agent reads. In auto-low it asks itself "did they ask for this?"; in auto-high it is told to`,
        `weigh the situation itself and act on its own judgement where a question would only delay.`,
        `Use it only for a model you would trust with the decisions a careful assistant makes unasked.`,
        `Risk: the same acts as auto-low, decided with less deference to you. What you gain: fewer stops`,
        `from a capable model.`,
        off,
      ];
    case "skip-permissions":
      return [
        `skip-permissions — ${MODE_MEANS["skip-permissions"]}`,
        `What happens: every act runs, locked or not, asked or not. The agent may unlock things, share,`,
        `sign with the wallet, sign devices out, erase files and the account. Erasing still needs`,
        `--reason "<why now>", and the reason is kept in this machine's run log.`,
        `Risk: everything this account holds and everything its wallet holds. This is the mode for "I do`,
        `not want to be asked anything and I accept whatever happens". What you gain: nothing waits.`,
        off,
      ];
  }
}

/** The sentence a person types to turn skip-permissions on. Nobody types it by accident. */
export const SKIP_SENTENCE = "NOTHING WILL ASK ME AND I ACCEPT THAT";

/** Whether an agent, rather than a person, is taken to be driving. */
export function isAgentMode(mode: Autonomy): boolean {
  return mode !== "default";
}

interface Stored {
  mode: Autonomy;
  setAt: string;
  byVersion: string;
}

function path(): string {
  return join(configDir(), "autonomy.json");
}

/**
 * Read a stored name, including the two this tool wrote before 2026-09-06: `off` is `default`
 * and `auto` is `auto-low`. Anything else counts as `default`.
 */
export function modeFromStored(value: unknown): Autonomy {
  if (value === "off") return "default";
  if (value === "auto") return "auto-low";
  return typeof value === "string" && (AUTONOMY_MODES as readonly string[]).includes(value)
    ? (value as Autonomy)
    : "default";
}

/**
 * What this machine is set to.
 *
 * ⛔ Unreadable counts as `default`. The fail-safe direction for "I do not know" is the one where
 *    somebody is still asked -- a file that switches autonomy on when it cannot be parsed is worse
 *    than no file at all.
 */
export function currentMode(): Autonomy {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path(), "utf8"));
    if (typeof parsed !== "object" || parsed === null) return "default";
    return modeFromStored(Reflect.get(parsed, "mode"));
  } catch {
    return "default";
  }
}

/** When it was set, or null when it is default or unreadable. */
export function setAt(): string | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path(), "utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const at: unknown = Reflect.get(parsed, "setAt");
    return typeof at === "string" ? at : null;
  } catch {
    return null;
  }
}

/** Write the choice down, with the date and the version that was asked. */
export function setMode(mode: Autonomy, version: string, now: Date): void {
  if (mode === "default") {
    if (existsSync(path())) rmSync(path(), { force: true });
    return;
  }
  const body: Stored = { mode, setAt: now.toISOString(), byVersion: version };
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  writeFileSync(path(), `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
  if (modesAreEnforced()) chmodSync(path(), 0o600);
}

/**
 * The line every run prints when a mode is on.
 *
 * ⛔ IT IS PRINTED EVERY TIME, not once. A setting that stops announcing itself is a setting people
 *    forget they turned on, and this one decides whether anybody is asked before money is spent.
 *    ⚠ It goes to stderr: stdout belongs to whatever is reading this tool's output.
 */
export function announcement(mode: Autonomy): string | null {
  if (mode === "default") return null;
  return `${BANNER_PREFIX}${mode} — ${MODE_MEANS[mode]} Turn it off with \`nmts mode default\`.`;
}

const BANNER_PREFIX = "nmts: autonomy is ";
