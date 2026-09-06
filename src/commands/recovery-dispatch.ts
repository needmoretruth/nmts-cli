// The recovery verbs (recovery · recovery-list · kit), dispatched here rather than in `main.ts`.
//
// ⛔ WHY A SECOND SWITCH. `main.ts` is measured (`check:size`) and had no room for `nmts support`;
//    this block shares a file and an option shape, so it moved as one piece with its comments.

import type { ParsedArgs } from "../args.ts";

export async function runRecovery(command: string, args: ParsedArgs): Promise<number> {
  switch (command) {
  case "recovery": {
    const { recovery } = await import("./recovery.ts");
    return await recovery({ out: args.out, force: args.force, json: args.json });
    }
  case "recovery-list": {
    const { recoveryList } = await import("./recovery-list.ts");
    return await recoveryList({
      server: args.server,
      network: args.network,
      out: args.out,
      force: args.force,
      json: args.json,
    });
    }
  case "kit": {
    const { kit } = await import("./kit.ts");
    return await kit({
      server: args.server,
      network: args.network,
      out: args.out,
      force: args.force,
      json: args.json,
    });
    }
    default:
      throw new Error(`not a recovery verb: ${command}`);
  }
}
