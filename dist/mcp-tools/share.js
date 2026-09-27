// Handing a file to another account, and taking it back.
//
// ⛔ THE UNDO DOES NOT UNDO IT, AND THE DESCRIPTION SAYS SO. Withdrawing a share stops further
//    downloads and reaches nothing already fetched. That is not a flaw waiting to be fixed — it is
//    what handing somebody a file means — so it is stated before the first share rather than after.
//
// ⛔ A PERSON HAS TO HAVE AGREED, AND THIS SURFACE CANNOT AGREE FOR THEM. Sharing is behind a
//    once-per-machine agreement in this tool's own record. If it has not been given, the first
//    call here stops and returns what the agreement says. ⚠ Show that to the person; do not run
//    the command that grants it on their behalf. Nothing in a command-line tool can tell whether a
//    person or a program typed a grant, so this is a rule rather than a mechanism, and saying
//    otherwise would be claiming a protection that is not there.
//
// ⛔ AND ON THIS SURFACE THE PERSON IS ASKED EVERY TIME. Once per
//    machine is the right shape for a capability and the wrong one for this act: the machine
//    agreed that sharing may happen, and no recorded agreement can say that THIS address is the
//    one that was meant. Every other tool here acts on the account's own files; this one hands a
//    key to somebody else, and the undo does not reach what has already been fetched. So the
//    question goes to the client, over `elicitation/create`, once per call.
//
// ⛔ NO WAY TO ASK MEANS NO SHARE. A client that did not declare elicitation gets a refusal that
//    names the terminal command instead. Falling back to the recorded agreement would let the
//    least capable client decide the rule for all of them.
//
// ⛔ A MODE THAT WAS TURNED ON IS THE ANSWER ALREADY GIVEN. With `auto` or `skip-permissions` set,
//    the person has said in writing that an agent may decide, and asking anyway would be ignoring
//    them — the modes exist for the unattended case, which is exactly the case where nobody is
//    there to answer. The mode was typed with a flag that spells out the risk, and every run that
//    uses one announces it.
//
// ⛔ THE RECIPIENT'S PUBLIC CODE IS NOT CHECKED AGAINST A PERSON. A share sent to a well-formed
//    code that belongs to somebody else is sent, and is not recallable. Confirm it with whoever
//    gave it to you, out of band, before calling this.
import { newCode, revokeCodeCommand } from "../commands/public-code-manage.js";
import { share, unshare } from "../commands/share.js";
import { common, needString, say } from "./context.js";
/** A code's number from a tool call, as the command takes it. The schema already said it is an integer. */
function numberArg(args, name) {
    const value = args[name];
    return typeof value === "number" ? String(value) : undefined;
}
export function shareTools(ctx) {
    return [
        {
            name: "nmts_public_code_new",
            description: "Make a new public code for this account — the next number from the same NMTS key — and " +
                "publish it, so other accounts can send files to it. `replace` names a live code to revoke " +
                "in the same step: nobody can send to that one again and nobody can bring it back. The " +
                "server caps how many codes are live at once and how many are made per UTC day; the reply " +
                "of nmts_public_code says both.",
            inputSchema: {
                type: "object",
                properties: {
                    replace: {
                        type: "integer",
                        description: "The number of a live code to revoke in the same step, from nmts_public_code.",
                    },
                },
                additionalProperties: false,
            },
            run: (args) => say((write) => newCode({ ...common(ctx), json: true, yes: true, replace: numberArg(args, "replace"), write })),
        },
        {
            name: "nmts_public_code_revoke",
            description: "Revoke one of this account's public codes, by its number from nmts_public_code. Nobody can " +
                "send to it again and nobody can bring it back; files already received with it stay and " +
                "still open. The account's last live code cannot be revoked — make a new one with " +
                "nmts_public_code_new and `replace` instead.",
            inputSchema: {
                type: "object",
                properties: {
                    index: { type: "integer", description: "The code's number, from nmts_public_code." },
                },
                required: ["index"],
                additionalProperties: false,
            },
            run: (args) => say((write) => revokeCodeCommand(numberArg(args, "index"), { ...common(ctx), json: true, yes: true, write })),
        },
        {
            name: "nmts_share",
            description: "Give another NMTS account the key to one file in this account. ⛔ IT CANNOT BE TAKEN " +
                "BACK: withdrawing the share stops further downloads and cannot reach a copy the " +
                "recipient already fetched, and a public code typed wrongly is a share sent to whoever " +
                "holds that code. The first share on a machine stops and asks the person to agree — show " +
                "them what it says rather than agreeing for them. Nothing is uploaded and nothing is " +
                "charged; the recipient pays nothing either. Every call puts the file and the code in " +
                "front of the person to confirm, unless they have turned on a mode that says an agent " +
                "may decide.",
            inputSchema: {
                type: "object",
                properties: {
                    path: { type: "string", description: "The file to share, as nmts_list prints it." },
                    public_code: {
                        type: "string",
                        description: "The recipient's PUBLIC CODE, given to you by them. Not their NMTS key.",
                    },
                    as: {
                        type: "integer",
                        description: "Which of this account's live public codes sends it, by number from nmts_public_code. " +
                            "Absent: the lowest-numbered live one.",
                    },
                },
                required: ["path", "public_code"],
                additionalProperties: false,
            },
            run: async (args) => {
                const path = needString(args, "path");
                const code = needString(args, "public_code");
                return say((write) => share(path, code, { ...common(ctx), json: true, as: numberArg(args, "as"), write }));
            },
        },
        {
            name: "nmts_unshare",
            description: "Withdraw a share this account made, using an id from nmts_shares. It stops any further " +
                "download and does NOT reach a copy already fetched. Safe to call: taking something back " +
                "is the direction this door is meant to fail in.",
            inputSchema: {
                type: "object",
                properties: { id: { type: "string", description: "The share id, from nmts_shares." } },
                required: ["id"],
                additionalProperties: false,
            },
            run: (args) => say((write) => unshare(needString(args, "id"), { ...common(ctx), json: true, write })),
        },
    ];
}
