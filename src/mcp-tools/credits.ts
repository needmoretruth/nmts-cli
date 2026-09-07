// Moving credits between two accounts of one person's own family — the account they made, and
// every account made under it.
//
// ⛔ IT CANNOT REACH ANYONE ELSE, and the description says so before the first call. The server
//    refuses a recipient outside the family and answers an account that does not exist in exactly
//    the same words, so this tool cannot be used to find out which identifiers are real — and a
//    model that read the refusal as "wrong identifier, try another" would be walking the account
//    space one guess at a time.
//
// ⛔ IT IS REVERSIBLE AND THAT IS WHY IT IS MEDIUM RATHER THAN HIGH. Nothing is spent, nothing
//    leaves the person's own accounts, and the same call the other way puts it back. What it is
//    NOT is `low`: it moves value, and the person should know it happened.
//
// ⚠ IT NEEDS THE ACCOUNT'S HUMAN CHECK TO BE LIVE, the same as the free trial. The command asks
//   about that first and the refusal names `nmts verify`, which is a person's act — so a model
//   that meets it must hand it to somebody rather than retry.

import { credits } from "../commands/credits.ts";
import type { ToolDefinition } from "../mcp.ts";
import { common, needString, say, type ToolContext } from "./context.ts";

export function creditTools(ctx: ToolContext): ToolDefinition[] {
  return [
    {
      name: "nmts_credits_transfer",
      description:
        "Move credits from this account to another account of the SAME FAMILY — the account a " +
        "person made and every account made under it — and nowhere else. Use it when the free " +
        "trial's credits landed on one account and the work is happening in another: the whole " +
        "family gets one application a week, not one each. The credits keep the date they were " +
        "already going to lapse on; moving them does not renew them, and nothing is spent by " +
        "moving them. The reply carries both balances. ⛔ A recipient outside the family and an " +
        "account that does not exist are refused in the same words — do not treat that refusal " +
        "as an invitation to try another identifier. It also needs the account's human check to " +
        "be live; when it is not, the refusal names `nmts verify`, which only a person can run.",
      inputSchema: {
        type: "object",
        properties: {
          to: {
            type: "string",
            description:
              "The receiving account's identifier, as nmts_whoami prints it for that account. " +
              "It has to be an account of this family. Not a public code and not an NMTS key.",
          },
          credits: {
            // ⚠ NO `minimum` HERE. The transport enforces only the keywords `mcp-args.ts` knows,
            //   and a schema keyword nothing enforces is a promise the surface does not keep —
            //   so the floor is checked in `run`, where it is real.
            type: "integer",
            description: "How many whole credits to move, above zero. nmts_balance says how many there are.",
          },
        },
        required: ["to", "credits"],
        additionalProperties: false,
      },
      run: (args) => {
        const to = needString(args, "to");
        const amount = args["credits"];
        if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 1) {
          throw new Error("`credits` must be a whole number of credits above zero.");
        }
        return say((write) =>
          credits("transfer", String(amount), { ...common(ctx), to, json: true, write }),
        );
      },
    },
  ];
}
