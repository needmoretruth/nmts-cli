// The tools that only look: what the account holds, what it is spending, what is about to expire.
//
// ⛔ NONE OF THESE COST ANYTHING AND NONE OF THEM WRITE. That is worth stating rather than
//    assuming, because it is what makes them safe to call in a loop — an agent working out what to
//    do next will call them repeatedly, and a surface where "just checking" costs money teaches
//    the opposite of the habit this tool wants.

import { publicCode } from "../commands/public-code.ts";
import { balance } from "../commands/balance.ts";
import { devices } from "../commands/devices.ts";
import { legal, notices } from "../commands/documents.ts";
import { expiring } from "../commands/expiring.ts";
import { losses } from "../commands/losses.ts";
import { ls } from "../commands/ls.ts";
import { shares } from "../commands/share.ts";
import { sharesSent } from "../commands/shares-sent.ts";
import { usage } from "../commands/usage.ts";
import { walletActivity } from "../commands/wallet-activity.ts";
import { walletStorage } from "../commands/wallet-storage.ts";
import type { ToolDefinition } from "../mcp.ts";
import { common, needString, say, type ToolContext } from "./context.ts";

const NO_ARGS = { type: "object", properties: {}, additionalProperties: false } as const;

export function readTools(ctx: ToolContext): ToolDefinition[] {
  return [
    {
      name: "nmts_list",
      description:
        "List the files stored in the NMTS account, as JSON. Paths are what nmts_get takes. " +
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
      run: (args) =>
        say((write) =>
          ls({
            ...common(ctx),
            json: true,
            all: args["include_trashed"] === true,
            ...(typeof args["find"] === "string" ? { find: args["find"] } : {}),
            ...(typeof args["sort"] === "string" ? { sort: args["sort"] } : {}),
            ...(args["descending"] === true ? { desc: true } : {}),
            write,
          }),
        ),
    },
    {
      name: "nmts_usage",
      description:
        "How much this account holds: how many files and folders, how many bytes, how much is in " +
        "the trash, and the largest few. Reads the account's own sealed list — it costs nothing " +
        "and says nothing about credits.",
      inputSchema: NO_ARGS,
      run: () => say((write) => usage({ ...common(ctx), json: true, write })),
    },
    {
      name: "nmts_expiring",
      description:
        "Files whose bought storage runs out soon, with how long each has left. Storage on NMTS " +
        "is a lease, not a purchase: a file whose lease ends is gone. Reads the storage " +
        "network's own clock, so it refuses rather than guessing when it cannot reach it.",
      inputSchema: NO_ARGS,
      run: () => say((write) => expiring({ ...common(ctx), json: true, write })),
    },
    {
      name: "nmts_losses",
      description:
        "Storage objects paid with this account's credits that NMTS's daily check could not find " +
        "on the chain, newest first. Read-only; costs nothing. Each row is a public chain object " +
        "id and the day a check first missed it — no file name, because the server cannot pair " +
        "them.",
      inputSchema: NO_ARGS,
      run: () => say((write) => losses({ ...common(ctx), json: true, write })),
    },
    {
      name: "nmts_balance",
      description:
        "How many credits this account has left, what that buys, and the ceilings on spending. " +
        "Read this before uploading anything large: the price of an upload is printed, but only " +
        "this says whether the account can pay it.",
      inputSchema: NO_ARGS,
      run: () => say((write) => balance({ ...common(ctx), json: true, write })),
    },
    {
      name: "nmts_wallet_activity",
      description:
        "The recent transactions of the wallet this account derives (newest first, 20 at most), " +
        "each named only where the chain proves it — seal, extend, erase, exchange, send, receive, " +
        "otherwise 'other' — with its balance changes and an explorer link. Read-only. Gifts to the " +
        "developer appear as sends here; this tool does not know that address.",
      inputSchema: NO_ARGS,
      run: () => say((write) => walletActivity({ ...common(ctx), json: true, write })),
    },
    {
      name: "nmts_wallet_storage",
      description:
        "The storage resources (size × time on the storage network) this wallet holds unbound — " +
        "what deleting a file from the network gave back — with whether each is usable now. " +
        "Read-only; nothing here spends or signs.",
      inputSchema: NO_ARGS,
      run: () => say((write) => walletStorage({ ...common(ctx), json: true, write })),
    },
    {
      name: "nmts_devices",
      description:
        "What is signed in to this NMTS account: for each device, when it was first signed in, " +
        "when it was last used, and when it runs out. ⛔ READ-ONLY. Signing a device out is a " +
        "person's act at nmts.me and no API key can do it — including this one — so if a row " +
        "looks wrong, say so and let the person end it rather than looking for a way to do it " +
        "here. ⚠ The name each device was given is encrypted with the account code, which the " +
        "server has never had, so no name is returned.",
      inputSchema: NO_ARGS,
      run: () => say((write) => devices({ server: ctx.server, json: true, write })),
    },
    {
      name: "nmts_public_code",
      description:
        "The account's PUBLIC CODE — the value other accounts send files to — and whether it has " +
        "been published yet. Until it is published nobody can send to this account. ⛔ It only " +
        "reads. Publishing is permanent and is a person's decision at the command line: if the " +
        "reply says it is not published, say so rather than working around it. ⚠ Not the account " +
        "code, which opens every file and is never given away.",
      inputSchema: NO_ARGS,
      run: () => say((write) => publicCode({ ...common(ctx), json: true, write })),
    },
    {
      name: "nmts_shares",
      description:
        "Files this account has shared with somebody, and files somebody has shared with it. The " +
        "ids in the received list are what nmts_receive takes; the ids in the sent list are what " +
        "nmts_unshare takes.",
      inputSchema: NO_ARGS,
      run: () => say((write) => shares({ ...common(ctx), json: true, write })),
    },
    {
      name: "nmts_shares_sent",
      description:
        "Who one file in the account was shared with: recipient address, since when, and the " +
        "share id. Read-only; costs nothing.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "The file, as nmts_list prints it." },
        },
        required: ["path"],
        additionalProperties: false,
      },
      run: (args) =>
        say((write) => sharesSent(needString(args, "path"), { ...common(ctx), json: true, write })),
    },
    // ── The documents this service publishes ──────────────────────────────────────────────────
    //
    // ⛔ THEY ARE HERE BECAUSE AN AGENT IS OFTEN THE ONLY READER. An account driven from a program
    //    is still governed by the Terms, and is still owed the seven days' warning a notice gives
    //    before a new version takes effect. A surface that could upload but could not read the
    //    notice saying uploads stop on Tuesday is a surface that keeps somebody uninformed.
    //
    // ⛔ NONE OF THEM SAVES A FILE. Keeping a dated copy is `nmts notices --save`, at a command
    //    line, where a person chose the directory — the rule this whole surface is built on.
    {
      name: "nmts_notices",
      description:
        "The NMTS notice board as JSON, newest first: interruptions, incidents, and the notice " +
        "given before a new version of the Terms takes effect. Ids here are what nmts_notice " +
        "takes. Public and read-only; it costs nothing and needs no account.",
      inputSchema: NO_ARGS,
      run: () => say((write) => notices({ ...common(ctx), json: true, write })),
    },
    {
      name: "nmts_notice",
      description:
        "One notice in full, as the dated text the board's download button writes — the same " +
        "bytes. Read this before acting on anything nmts_notices only summarised.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "The notice, as nmts_notices lists it." },
        },
        required: ["id"],
        additionalProperties: false,
      },
      run: (args) => say((write) => notices({ ...common(ctx), id: needString(args, "id"), write })),
    },
    {
      name: "nmts_terms",
      description:
        "The NMTS Terms of Service in force, as text, with its version and effective date at the " +
        "head. ⛔ Reading them is not accepting them: nothing here or anywhere in this tool can " +
        "agree to a document on somebody's behalf, and the server refuses until a person does it " +
        "at nmts.me.",
      inputSchema: {
        type: "object",
        properties: {
          lang: { type: "string", enum: ["en", "ko"], description: "Absent means English, the canonical text." },
          board: { type: "boolean", description: "The message board's terms rather than the service's." },
        },
        additionalProperties: false,
      },
      run: (args) =>
        say((write) =>
          legal("terms", {
            ...common(ctx),
            ...(typeof args["lang"] === "string" ? { lang: args["lang"] } : {}),
            ...(args["board"] === true ? { board: true } : {}),
            write,
          }),
        ),
    },
    {
      name: "nmts_privacy",
      description:
        "The NMTS Privacy Policy in force, as text, with its version and effective date at the " +
        "head. It is what the service says it collects and keeps; read it rather than describing " +
        "it from memory.",
      inputSchema: {
        type: "object",
        properties: {
          lang: { type: "string", enum: ["en", "ko"], description: "Absent means English, the canonical text." },
        },
        additionalProperties: false,
      },
      run: (args) =>
        say((write) =>
          legal("privacy", {
            ...common(ctx),
            ...(typeof args["lang"] === "string" ? { lang: args["lang"] } : {}),
            write,
          }),
        ),
    },
  ];
}
