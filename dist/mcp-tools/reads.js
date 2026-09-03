// The tools that only look: what the account holds, what it is spending, what is about to expire.
//
// ⛔ NONE OF THESE COST ANYTHING AND NONE OF THEM WRITE. That is worth stating rather than
//    assuming, because it is what makes them safe to call in a loop — an agent working out what to
//    do next will call them repeatedly, and a surface where "just checking" costs money teaches
//    the opposite of the habit this tool wants.
import { publicCode } from "../commands/public-code.js";
import { balance } from "../commands/balance.js";
import { expiring } from "../commands/expiring.js";
import { losses } from "../commands/losses.js";
import { ls } from "../commands/ls.js";
import { shares, sharesSent } from "../commands/share.js";
import { usage } from "../commands/usage.js";
import { common, needString, say } from "./context.js";
const NO_ARGS = { type: "object", properties: {}, additionalProperties: false };
export function readTools(ctx) {
    return [
        {
            name: "nmts_list",
            description: "List the files stored in the NMTS account, as JSON. Paths are what nmts_get takes. " +
                "Entries in the trash are left out unless include_trashed is true, and the reply says " +
                "how many were left out. Optionally narrow with a search word and choose an order.",
            inputSchema: {
                type: "object",
                properties: {
                    include_trashed: { type: "boolean", description: "Include what is in the trash." },
                    find: { type: "string", description: "Keep only entries whose name contains this." },
                    sort: {
                        type: "string",
                        enum: ["name", "size", "date"],
                        description: "Order the listing. Absent means the path order this tool has always printed.",
                    },
                    descending: { type: "boolean", description: "Reverse the order." },
                },
                additionalProperties: false,
            },
            run: (args) => say((write) => ls({
                ...common(ctx),
                json: true,
                all: args["include_trashed"] === true,
                ...(typeof args["find"] === "string" ? { find: args["find"] } : {}),
                ...(typeof args["sort"] === "string" ? { sort: args["sort"] } : {}),
                ...(args["descending"] === true ? { desc: true } : {}),
                write,
            })),
        },
        {
            name: "nmts_usage",
            description: "How much this account holds: how many files and folders, how many bytes, how much is in " +
                "the trash, and the largest few. Reads the account's own sealed list — it costs nothing " +
                "and says nothing about credits.",
            inputSchema: NO_ARGS,
            run: () => say((write) => usage({ ...common(ctx), json: true, write })),
        },
        {
            name: "nmts_expiring",
            description: "Files whose bought storage runs out soon, with how long each has left. Storage on NMTS " +
                "is a lease, not a purchase: a file whose lease ends is gone. Reads the storage " +
                "network's own clock, so it refuses rather than guessing when it cannot reach it.",
            inputSchema: NO_ARGS,
            run: () => say((write) => expiring({ ...common(ctx), json: true, write })),
        },
        {
            name: "nmts_losses",
            description: "Storage objects paid with this account's credits that NMTS's daily check could not find " +
                "on the chain, newest first. Read-only; costs nothing. Each row is a public chain object " +
                "id and the day a check first missed it — no file name, because the server cannot pair " +
                "them.",
            inputSchema: NO_ARGS,
            run: () => say((write) => losses({ ...common(ctx), json: true, write })),
        },
        {
            name: "nmts_balance",
            description: "How many credits this account has left, what that buys, and the ceilings on spending. " +
                "Read this before uploading anything large: the price of an upload is printed, but only " +
                "this says whether the account can pay it.",
            inputSchema: NO_ARGS,
            run: () => say((write) => balance({ ...common(ctx), json: true, write })),
        },
        {
            name: "nmts_public_code",
            description: "The account's PUBLIC CODE — the value other accounts send files to — and whether it has " +
                "been published yet. Until it is published nobody can send to this account. ⛔ It only " +
                "reads. Publishing is permanent and is a person's decision at the command line: if the " +
                "reply says it is not published, say so rather than working around it. ⚠ Not the account " +
                "code, which opens every file and is never given away.",
            inputSchema: NO_ARGS,
            run: () => say((write) => publicCode({ ...common(ctx), json: true, write })),
        },
        {
            name: "nmts_shares",
            description: "Files this account has shared with somebody, and files somebody has shared with it. The " +
                "ids in the received list are what nmts_receive takes; the ids in the sent list are what " +
                "nmts_unshare takes.",
            inputSchema: NO_ARGS,
            run: () => say((write) => shares({ ...common(ctx), json: true, write })),
        },
        {
            name: "nmts_shares_sent",
            description: "Who one file in the account was shared with: recipient address, since when, and the " +
                "share id. Read-only; costs nothing.",
            inputSchema: {
                type: "object",
                properties: {
                    path: { type: "string", description: "The file, as nmts_list prints it." },
                },
                required: ["path"],
                additionalProperties: false,
            },
            run: (args) => say((write) => sharesSent(needString(args, "path"), { ...common(ctx), json: true, write })),
        },
    ];
}
