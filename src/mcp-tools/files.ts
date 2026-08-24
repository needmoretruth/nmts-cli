// Fetching files out of the account, and putting files into it.
//
// ⛔ TWO OF THESE SPEND AND THEIR DESCRIPTIONS SAY SO FIRST. A model reads the description before
//    it decides; burying the cost after the parameters is how a tool gets called to "see what
//    happens". Both take a dry_run that prices without spending, and the transport now refuses a
//    dry_run that is not a real boolean — before that check, `"true"` read as false and the paid
//    branch ran.
//
// ⛔ EVERY DESTINATION IS DERIVED FROM THE DIRECTORY THE PERSON CHOSE. No tool here takes a path on
//    this disk. `nmts_get` keeps only the last segment of the account path; `nmts_pull` builds its
//    tree under that directory and refuses a stored name that would climb out; `nmts_receive` uses
//    the sender's name the same way. The only path a model may choose is one INSIDE the account.

import { get } from "../commands/get.ts";
import { pull } from "../commands/pull.ts";
import { push } from "../commands/push.ts";
import { put } from "../commands/put.ts";
import { receive } from "../commands/receive.ts";
import type { ToolDefinition } from "../mcp.ts";
import { destinationFor } from "../safe-path.ts";
import { common, needString, say, type ToolContext } from "./context.ts";

const SPENDS =
  "⛔ THIS SPENDS THE ACCOUNT'S CREDITS — one credit per started mebibyte, per lease period, and " +
  "credits are not refundable. Pass dry_run to be told the price without spending it. The first " +
  "upload on a machine stops and asks the person to agree; show them what it says rather than " +
  "agreeing for them.";

export function fileTools(ctx: ToolContext): ToolDefinition[] {
  return [
    {
      name: "nmts_get",
      description:
        `Fetch one file from the NMTS account, decrypt it, and write it into ${ctx.outDir}. Takes ` +
        `a path exactly as nmts_list prints it. It leaves nothing at that name rather than ` +
        `writing a wrong or partial file, and it will not replace a file that is already there. ` +
        `The reply says where it went.`,
      inputSchema: {
        type: "object",
        properties: { path: { type: "string", description: "The file's path inside the account." } },
        required: ["path"],
        additionalProperties: false,
      },
      run: (args) => {
        const wanted = needString(args, "path");
        return say((write) =>
          get(wanted, { ...common(ctx), out: destinationFor(ctx.outDir, wanted), json: true, write }),
        );
      },
    },
    {
      name: "nmts_pull",
      description:
        `Fetch a whole folder — or the whole account, if no folder is named — and rebuild its ` +
        `shape under ${ctx.outDir}. Unlike fetching one file it carries on past a file that will ` +
        `not come back, because getting nineteen of twenty is better than getting none; the reply ` +
        `lists what was written, what was skipped as already there, and what failed and why.`,
      inputSchema: {
        type: "object",
        properties: {
          folder: {
            type: "string",
            description: "A folder path inside the account. Omit for everything.",
          },
        },
        additionalProperties: false,
      },
      run: (args) =>
        say((write) =>
          pull(typeof args["folder"] === "string" ? args["folder"] : undefined, {
            ...common(ctx),
            out: ctx.outDir,
            json: true,
            write,
          }),
        ),
    },
    {
      name: "nmts_receive",
      description:
        `Fetch a file another account shared with this one, using an id from nmts_shares, and ` +
        `write it into ${ctx.outDir} under the name the sender gave it. The sender's identity is ` +
        `checked before anything is opened.`,
      inputSchema: {
        type: "object",
        properties: { id: { type: "string", description: "The share id, from nmts_shares." } },
        required: ["id"],
        additionalProperties: false,
      },
      run: (args) =>
        say((write) =>
          receive(needString(args, "id"), { ...common(ctx), intoDir: ctx.outDir, json: true, write }),
        ),
    },
    {
      name: "nmts_put",
      description:
        `Encrypt one file from this machine and upload it to the NMTS account. ${SPENDS} A name ` +
        `already taken in the destination is numbered rather than replacing what is there.`,
      inputSchema: {
        type: "object",
        properties: {
          file: { type: "string", description: "Path to a file ON THIS MACHINE to upload." },
          name: { type: "string", description: "The name it gets in the account. Defaults to the file's own." },
          to: { type: "string", description: "An existing folder in the account, as nmts_list prints it." },
          dry_run: { type: "boolean", description: "Say what it would cost and stop. Nothing is sent or charged." },
        },
        required: ["file"],
        additionalProperties: false,
      },
      run: (args) =>
        say((write) =>
          put(needString(args, "file"), {
            ...common(ctx),
            json: true,
            ...(typeof args["name"] === "string" ? { name: args["name"] } : {}),
            ...(typeof args["to"] === "string" ? { to: args["to"] } : {}),
            ...(args["dry_run"] === true ? { dryRun: true } : {}),
            write,
          }),
        ),
    },
    {
      name: "nmts_push",
      description:
        `Upload a whole directory from this machine, rebuilding its shape in the account. ` +
        `${SPENDS} ⛔ It stops at the FIRST failure rather than carrying on — the opposite of ` +
        `nmts_pull, and on purpose: a failure that really means the account cannot pay any more ` +
        `would, if carried past, ask to pay for every remaining file. Files already in the ` +
        `destination are skipped, so running it again is safe and sends only what is missing. ` +
        `Names beginning with a dot are left alone unless include_hidden is true — a directory of ` +
        `source code keeps its credentials in exactly those files.`,
      inputSchema: {
        type: "object",
        properties: {
          directory: { type: "string", description: "Path to a directory ON THIS MACHINE." },
          to: { type: "string", description: "An existing folder in the account to put it under." },
          include_hidden: { type: "boolean", description: "Also send names beginning with a dot." },
          dry_run: { type: "boolean", description: "Price the whole tree and stop. Nothing is sent or charged." },
        },
        required: ["directory"],
        additionalProperties: false,
      },
      run: (args) =>
        say((write) =>
          push(needString(args, "directory"), {
            ...common(ctx),
            json: true,
            ...(typeof args["to"] === "string" ? { to: args["to"] } : {}),
            ...(args["include_hidden"] === true ? { hidden: true } : {}),
            ...(args["dry_run"] === true ? { dryRun: true } : {}),
            write,
          }),
        ),
    },
  ];
}
