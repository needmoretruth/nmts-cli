// The three commands that only read or write a setting on this machine.
//
// ⛔ THEY ARE TOGETHER BECAUSE THEY ARE THE SAME KIND OF THING, not to save lines in `main.ts`.
//    None of them touch the network, an account, or a file in the drive: each one prints what this
//    machine is set to, or records a new answer. Keeping the dispatch for them in one place means
//    the next setting has an obvious home, rather than another case in the middle of the commands
//    that move money.
//
// ⚠ What each setting MEANS is not here — it is beside the setting itself (`consent.ts`,
//   `autonomy.ts`, `collision.ts`), so a caller that needs the rule does not have to load a
//   command to get it.

import type { ParsedArgs } from "../args.ts";

/** Is this one of the settings commands? */
export function isSettingsCommand(command: string): boolean {
  return command === "consent" || command === "mode" || command === "on-collision";
}

/** Run it. Only call this when `isSettingsCommand` said yes. */
export async function runSettings(command: string, args: ParsedArgs): Promise<number> {
  if (command === "consent") {
    const { consent } = await import("./consent.ts");
    return consent(args.operands[0], args.operands[1], { json: args.json });
  }
  if (command === "mode") {
    const { mode } = await import("./mode.ts");
    return mode(args.operands[0], { json: args.json, accepted: args.iAcceptTheRisk });
  }
  const { onCollision } = await import("./on-collision.ts");
  return onCollision(args.operands[0], { json: args.json });
}
