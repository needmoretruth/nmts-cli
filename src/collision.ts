// What this machine does when an upload's name is already in use.
//
// ⛔ ASKED ONCE, AT SETUP, BECAUSE THERE IS NOBODY TO ASK LATER. This tool is run by backup jobs
//    and by agents; a prompt in the middle of one is a prompt nobody sees, and a job that stops to
//    wait for an answer has stopped. So the question is put where a person is definitely present
//    -- signing in -- and the answer is kept.
//
// ⛔ THE DEFAULT IS TO RENAME, AND IT IS THE DEFAULT ON PURPOSE. Renaming loses nothing: the old
//    file stays and the new one arrives beside it. Overwriting cannot be taken back -- NMTS keeps
//    no previous versions -- so the direction that is chosen when nobody has chosen is the one
//    where nothing is destroyed.
//
// ⛔ AN AGENT MAY NOT PICK OVERWRITE UNLESS A MODE SAYS IT MAY (owner, 2026-08-25: unless YOLO or
//    auto mode is on, the agent picks rename; with one on it decides for itself). That rule is
//    enforced here rather than written down in the instructions and hoped for: `chosenBy` refuses
//    to return `overwrite` for an agent while autonomy is off.
//
// ⚠ WHAT THIS CANNOT DO is tell an agent from a person. Nothing on a command line can. What it can
//   do is make the destructive answer require a setting that was turned on deliberately, and say
//   which setting decided.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";

import { currentMode, type Autonomy } from "./autonomy.ts";
import { configDir, modesAreEnforced } from "./credentials.ts";

/** What to do with a name that is already in use. Mirrors the browser's two buttons. */
export type OnCollision = "rename" | "overwrite";

export const COLLISION_CHOICES: readonly OnCollision[] = ["rename", "overwrite"];

/** What each choice does, in the words the tool prints. One line each. */
export const COLLISION_MEANS: Readonly<Record<OnCollision, string>> = {
  rename: "Store it beside the old one as `name (2).ext`. Nothing is lost. This is the default.",
  overwrite: "Delete the file that is there and store this one. It cannot be brought back.",
};

/** What is written down when nobody has chosen. */
export const DEFAULT_COLLISION: OnCollision = "rename";

interface Stored {
  onCollision: OnCollision;
  setAt: string;
  byVersion: string;
}

function path(): string {
  return join(configDir(), "collision.json");
}

function isChoice(value: unknown): value is OnCollision {
  return typeof value === "string" && (COLLISION_CHOICES as readonly string[]).includes(value);
}

/**
 * What this machine is set to.
 *
 * ⛔ Unreadable counts as `rename`, for the same reason autonomy unreadable counts as off: the
 *    fail-safe direction for "I do not know" is the one that destroys nothing.
 */
export function currentChoice(): OnCollision {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path(), "utf8"));
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_COLLISION;
    const choice: unknown = Reflect.get(parsed, "onCollision");
    return isChoice(choice) ? choice : DEFAULT_COLLISION;
  } catch {
    return DEFAULT_COLLISION;
  }
}

/** Has anybody answered on this machine? Used to know whether setup still has to ask. */
export function hasChosen(): boolean {
  return existsSync(path());
}

/** Write the choice down, with the date and the version that asked. */
export function setChoice(choice: OnCollision, version: string, now: Date): void {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  const body: Stored = { onCollision: choice, setAt: now.toISOString(), byVersion: version };
  writeFileSync(path(), `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
  if (modesAreEnforced()) chmodSync(path(), 0o600);
}

/** Forget the answer, so setup asks again. */
export function forgetChoice(): void {
  if (existsSync(path())) rmSync(path(), { force: true });
}

/** What decided, so the tool can say so rather than acting silently. */
export interface Decision {
  readonly choice: OnCollision;
  /**
   * What settled it.
   *
   * `setting` — what a person answered at setup, or the default when nobody has.
   * `asked-for` — an agent asked for this run to overwrite, and a mode allows it.
   * `agent-refused` — an agent asked to overwrite while no mode is on, so it renames instead.
   */
  readonly by: "setting" | "asked-for" | "agent-refused";
}

/**
 * What to do with this collision, and what settled it.
 *
 * ⛔ A STORED ANSWER IS A PERSON'S ANSWER AND IS NOT SECOND-GUESSED. Setup asks while somebody is
 *    definitely there; overriding that later because autonomy happens to be off would mean the
 *    tool ignoring the one answer it actually has from a person.
 *
 * ⛔ WHAT THE MODES GATE IS THE OTHER THING: an agent deciding, for THIS run, to overwrite when
 *    nobody said so. That is the case the owner ruled on -- without a mode the agent picks rename
 *    -- and it is enforced here rather than written in the instructions and hoped for.
 *
 * ⛔ THE OVERRIDE IS ONE-WAY. A mode can let `overwrite` through; nothing here turns a `rename`
 *    into an `overwrite`.
 */
export function decide(
  /** What this run asked for, if anything. `undefined` means "use what this machine is set to". */
  askedFor?: OnCollision,
  setting: OnCollision = currentChoice(),
  mode: Autonomy = currentMode(),
): Decision {
  if (askedFor === undefined) return { choice: setting, by: "setting" };
  if (askedFor === "rename") return { choice: "rename", by: "asked-for" };
  if (mode === "off") return { choice: "rename", by: "agent-refused" };
  return { choice: "overwrite", by: "asked-for" };
}

/** How the two answers are numbered where setup asks. Kept here so the question and the reading agree. */
export const ANSWER_NUMBER: Readonly<Record<OnCollision, string>> = { rename: "1", overwrite: "2" };

/**
 * What somebody typed at the setup question.
 *
 * ⛔ ONLY THE EXACT NUMBER FOR OVERWRITE COUNTS, and everything else is the safe answer. A typo, an
 *    empty line, a closed pipe, a stray space, `y`, `yes` — none of them mean "delete my files".
 *    The answer that destroys something has to be typed on purpose.
 */
export function readAnswer(typed: string): OnCollision {
  return typed.trim() === ANSWER_NUMBER.overwrite ? "overwrite" : "rename";
}
