// The share verbs (share · shares · unshare · receive), dispatched here rather than in `main.ts`.
//
// ⛔ WHY A SECOND SWITCH. `main.ts` is measured (`check:size`) and had no room for `nmts support`;
//    this block shares a file and an option shape, so it moved as one piece with its comments.
export async function runShare(command, args) {
    switch (command) {
        case "share": {
            const { share } = await import("./share.js");
            return await share(args.operands[0], args.operands[1], {
                server: args.server,
                network: args.network,
                json: args.json,
                yes: args.yes,
            });
        }
        case "shares": {
            const options = { server: args.server, network: args.network, json: args.json };
            if (args.sent !== undefined) {
                const { sharesSent } = await import("./shares-sent.js");
                return await sharesSent(args.sent, options);
            }
            const { shares } = await import("./share.js");
            return await shares(options);
        }
        case "unshare": {
            const { unshare } = await import("./share.js");
            return await unshare(args.operands[0], {
                server: args.server,
                network: args.network,
                json: args.json,
            });
        }
        case "receive": {
            const { receive } = await import("./receive.js");
            return await receive(args.operands[0], {
                server: args.server,
                network: args.network,
                out: args.out,
                force: args.force,
                json: args.json,
            });
        }
        default:
            throw new Error(`not a share verb: ${command}`);
    }
}
