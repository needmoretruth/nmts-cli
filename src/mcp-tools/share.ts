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
// ⛔ THE RECIPIENT'S PUBLIC CODE IS NOT CHECKED AGAINST A PERSON. A share sent to a well-formed
//    code that belongs to somebody else is sent, and is not recallable. Confirm it with whoever
//    gave it to you, out of band, before calling this.

import { share, unshare } from "../commands/share.ts";
import type { ToolDefinition } from "../mcp.ts";
import { common, needString, say, type ToolContext } from "./context.ts";

export function shareTools(ctx: ToolContext): ToolDefinition[] {
  return [
    {
      name: "nmts_share",
      description:
        "Give another NMTS account the key to one file in this account. ⛔ IT CANNOT BE TAKEN " +
        "BACK: withdrawing the share stops further downloads and cannot reach a copy the " +
        "recipient already fetched, and a public code typed wrongly is a share sent to whoever " +
        "holds that code. The first share on a machine stops and asks the person to agree — show " +
        "them what it says rather than agreeing for them. Nothing is uploaded and nothing is " +
        "charged; the recipient pays nothing either.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "The file to share, as nmts_list prints it." },
          public_code: {
            type: "string",
            description: "The recipient's PUBLIC CODE, given to you by them. Not their account code.",
          },
        },
        required: ["path", "public_code"],
        additionalProperties: false,
      },
      run: (args) =>
        say((write) =>
          share(needString(args, "path"), needString(args, "public_code"), {
            ...common(ctx),
            json: true,
            write,
          }),
        ),
    },
    {
      name: "nmts_unshare",
      description:
        "Withdraw a share this account made, using an id from nmts_shares. It stops any further " +
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
