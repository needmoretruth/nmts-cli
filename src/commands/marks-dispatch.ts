// The six mark verbs, dispatched here rather than in `main.ts`.
//
// ⛔ WHY A SECOND SWITCH. `main.ts` is measured (`check:size`) and had no room for `nmts support`;
//    these six cases were the one contiguous block that shares a file, an option shape and a
//    reason to be read together — `label --rename` and `unlabel --all` are sweeps over the whole
//    account wearing the verbs of a per-file mark, and the guard that keeps them from being
//    reached by accident is the comment below, which moved with them.

import type { ParsedArgs } from "../args.ts";

export async function runMarks(command: string, args: ParsedArgs): Promise<number> {
  switch (command) {
  case "star": {
    const { star } = await import("./marks.ts");
    return await star(args.operands, { server: args.server, network: args.network, json: args.json });
    }
  case "unstar": {
    const { unstar } = await import("./marks.ts");
    return await unstar(args.operands, { server: args.server, network: args.network, json: args.json });
    }
  case "pin": {
    const { pin } = await import("./marks.ts");
    return await pin(args.operands, { server: args.server, network: args.network, json: args.json });
    }
  case "unpin": {
    const { unpin } = await import("./marks.ts");
    return await unpin(args.operands, { server: args.server, network: args.network, json: args.json });
    }
  case "label": {
    const options = { server: args.server, network: args.network, json: args.json };
    // ⛔ `--rename` IS A DIFFERENT COMMAND WEARING THE SAME VERB, and it is dispatched here so
    //    that the label sweep cannot be reached by accident: `label <name> <files>` puts a mark
    //    on the files it names, and `label --rename <old> <new>` touches every file in the
    //    account. One takes paths and the other refuses them.
    if (args.rename !== undefined) {
      const { labelRename } = await import("./marks.ts");
      return await labelRename(args.rename, args.operands[0], options);
    }
    const { label } = await import("./marks.ts");
    return await label(args.operands[0], args.operands.slice(1), options);
    }
  case "unlabel": {
    const options = { server: args.server, network: args.network, json: args.json };
    if (args.all) {
      const { unlabelAll } = await import("./marks.ts");
      return await unlabelAll(args.operands[0], options);
    }
    const { unlabel } = await import("./marks.ts");
    return await unlabel(args.operands[0], args.operands.slice(1), options);
    }
    default:
      throw new Error(`not a mark verb: ${command}`);
  }
}
