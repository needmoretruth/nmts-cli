import { type Autonomy } from "./autonomy.ts";
/** What to do with a name that is already in use. Mirrors the browser's two buttons. */
export type OnCollision = "rename" | "overwrite";
export declare const COLLISION_CHOICES: readonly OnCollision[];
/** What each choice does, in the words the tool prints. One line each. */
export declare const COLLISION_MEANS: Readonly<Record<OnCollision, string>>;
/**
 * What a run asked for on the command line, or undefined for "use this machine's setting".
 *
 * ⛔ AN UNKNOWN WORD IS REFUSED, NOT ROUNDED DOWN. Silently reading `--on-collision overwite` as
 *    the safe answer would look like it worked, and the person would find out from the drive.
 */
export declare function parseAsked(typed: string | undefined): OnCollision | undefined;
/** What is written down when nobody has chosen. */
export declare const DEFAULT_COLLISION: OnCollision;
/**
 * What this machine is set to.
 *
 * ⛔ Unreadable counts as `rename`, for the same reason autonomy unreadable counts as off: the
 *    fail-safe direction for "I do not know" is the one that destroys nothing.
 */
export declare function currentChoice(): OnCollision;
/** Has anybody answered on this machine? Used to know whether setup still has to ask. */
export declare function hasChosen(): boolean;
/** Write the choice down, with the date and the version that asked. */
export declare function setChoice(choice: OnCollision, version: string, now: Date): void;
/** Forget the answer, so setup asks again. */
export declare function forgetChoice(): void;
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
export declare function decide(
/** What this run asked for, if anything. `undefined` means "use what this machine is set to". */
askedFor?: OnCollision, setting?: OnCollision, mode?: Autonomy): Decision;
/** How the two answers are numbered where setup asks. Kept here so the question and the reading agree. */
export declare const ANSWER_NUMBER: Readonly<Record<OnCollision, string>>;
/**
 * What somebody typed at the setup question.
 *
 * ⛔ ONLY THE EXACT NUMBER FOR OVERWRITE COUNTS, and everything else is the safe answer. A typo, an
 *    empty line, a closed pipe, a stray space, `y`, `yes` — none of them mean "delete my files".
 *    The answer that destroys something has to be typed on purpose.
 */
export declare function readAnswer(typed: string): OnCollision;
