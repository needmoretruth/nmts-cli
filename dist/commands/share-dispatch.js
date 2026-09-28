// The share verbs (share · shares · unshare · receive · link · links), dispatched here rather than in `main.ts`.
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
                as: args.as,
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
        case "link": {
            const { link } = await import("./link.js");
            return await link(args.operands[0], args.operands[1], {
                server: args.server,
                network: args.network,
                hideName: args.hideName,
                expires: args.expires,
                out: args.out,
                force: args.force,
                json: args.json,
            });
        }
        case "links": {
            const { links } = await import("./links.js");
            return await links(args.operands[0], args.operands[1], { server: args.server, network: args.network, json: args.json });
        }
        default:
            throw new Error(`not a share verb: ${command}`);
    }
}
