// The recovery verbs (recovery · recovery-list · kit), dispatched here rather than in `main.ts`.
//
// ⛔ WHY A SECOND SWITCH. `main.ts` is measured (`check:size`) and had no room for `nmts support`;
//    this block shares a file and an option shape, so it moved as one piece with its comments.
export async function runRecovery(command, args) {
    switch (command) {
        case "recovery": {
            const { recovery } = await import("./recovery.js");
            return await recovery({ out: args.out, force: args.force, json: args.json });
        }
        case "recovery-list": {
            const { recoveryList } = await import("./recovery-list.js");
            return await recoveryList({
                server: args.server,
                network: args.network,
                out: args.out,
                force: args.force,
                json: args.json,
            });
        }
        case "kit": {
            const { kit } = await import("./kit.js");
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
