// `nmts on-collision` — what this machine does when an upload's name is already in use.
//
// ⛔ IT IS A COMMAND FOR THE SAME REASON `mode` IS. The answer is asked for once while somebody is
//    signing in, but a machine that was set up by a script never saw that question, and a person
//    who answered it once has to be able to change it without signing in again.
//
// ⛔ NO RISK FLAG HERE, unlike `mode`. This setting does not hand a decision to an agent — it
//    records what a person wants — and the destructive answer is one word that says what it does.
//    What the modes gate is the other case, an agent choosing overwrite for one run with nobody
//    having said so, and that is enforced in `collision.ts` rather than by a flag on this command.

import {
  COLLISION_CHOICES,
  COLLISION_MEANS,
  currentChoice,
  setChoice,
  type OnCollision,
} from "../collision.ts";
import { NmtsError } from "../errors.ts";
import { BINARY_NAME, VERSION } from "../product.ts";

export interface OnCollisionOptions {
  json?: boolean;
  write?: (line: string) => void;
  now?: () => Date;
}

function isChoice(value: string): value is OnCollision {
  return (COLLISION_CHOICES as readonly string[]).includes(value);
}

export function onCollision(wanted: string | undefined, options: OnCollisionOptions = {}): number {
  const say = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const now = options.now ?? (() => new Date());

  if (wanted === undefined || wanted === "") {
    const at = currentChoice();
    if (options.json === true) {
      say(JSON.stringify({ onCollision: at, means: COLLISION_MEANS[at] }));
      return 0;
    }
    say(`${at} — ${COLLISION_MEANS[at]}`);
    // The other one, and how to pick it. Listing what exists without saying how to choose sends
    // the reader back to the help text.
    for (const other of COLLISION_CHOICES) {
      if (other !== at) say(`${other} — ${COLLISION_MEANS[other]}`);
    }
    say(`Change it: ${BINARY_NAME} on-collision <${COLLISION_CHOICES.join("|")}>`);
    return 0;
  }

  if (!isChoice(wanted)) {
    throw new NmtsError(`There is no such answer: "${wanted}".`, {
      exitCode: 2,
      nextStep: `One of: ${COLLISION_CHOICES.join(" · ")}`,
    });
  }

  setChoice(wanted, VERSION, now());
  say(`${wanted} — ${COLLISION_MEANS[wanted]}`);
  return 0;
}
