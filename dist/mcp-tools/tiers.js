// Every MCP tool carries the tier of the act it performs, and the same gate the command line runs.
//
// ⛔ ONE TABLE, HELD AGAINST THE SURFACE BY A TEST. A tool with no row here is a tool nobody
//    decided about, so the test compares this table with the tools actually served, both ways.
//
// ⛔ THE GATE RUNS BEFORE THE TOOL, IN THE TRANSPORT'S WRAPPER, so a tool cannot forget it. What
//    it does is what `gate.ts` does for a command: a locked act is refused until a person runs
//    `nmts unlock <key>` at a terminal; an act that needs the person's yes in this mode is put in
//    front of them over MCP elicitation, and refused when the client has no way to ask.
import { currentMode } from "../autonomy.js";
import { unlocked } from "../gate.js";
import { BINARY_NAME } from "../product.js";
import { ACTS } from "../risk.js";
const READ = { act: "ls", readOnly: true };
export const TOOL_TIERS = {
    nmts_whoami: { act: "whoami", readOnly: true },
    nmts_list: READ,
    nmts_usage: { act: "usage", readOnly: true },
    nmts_expiring: { act: "expiring", readOnly: true },
    nmts_losses: { act: "losses", readOnly: true },
    nmts_loss_recheck: { act: "losses", readOnly: true },
    nmts_balance: { act: "balance", readOnly: true },
    nmts_wallet_activity: { act: "wallet", readOnly: true },
    nmts_wallet_storage: { act: "wallet", readOnly: true },
    nmts_devices: { act: "devices", readOnly: true },
    nmts_public_code: { act: "public-code", readOnly: true },
    nmts_shares: { act: "shares", readOnly: true },
    nmts_shares_sent: { act: "shares", readOnly: true },
    nmts_notices: { act: "notices", readOnly: true },
    nmts_notice: { act: "notices", readOnly: true },
    nmts_terms: { act: "terms", readOnly: true },
    nmts_privacy: { act: "privacy", readOnly: true },
    nmts_get: { act: "get" },
    nmts_pull: { act: "pull" },
    nmts_receive: { act: "receive" },
    nmts_put: { act: "put" },
    nmts_push: { act: "push" },
    nmts_mkdir: { act: "mkdir" },
    nmts_move: { act: "mv" },
    nmts_rename: { act: "rename" },
    nmts_mark: { act: "star" },
    nmts_label_rename: { act: "label" },
    nmts_unlabel_all: { act: "unlabel" },
    nmts_padding: { act: (args) => (typeof args["mode"] === "string" ? "padding.set" : "padding") },
    nmts_deposit: { act: (args) => (typeof args["credits"] === "number" ? "deposit.set" : "deposit") },
    nmts_trash: { act: "rm" },
    nmts_restore: { act: "restore" },
    nmts_share: {
        act: "share",
        question: (args) => `Share "${String(args["path"])}" with the NMTS account whose public code is ${String(args["public_code"])}?\n\n` +
            "Whoever holds that code can then download the file. Withdrawing the share afterwards stops " +
            "further downloads and cannot reach a copy already fetched. The code is not checked against " +
            "a person — if it is the wrong one, the file goes to whoever holds it.",
    },
    nmts_unshare: { act: "unshare" },
    nmts_support_send: { act: "support.send" },
    nmts_support_list: { act: "support", readOnly: true },
    nmts_support_show: { act: "support", readOnly: true },
    nmts_support_reply: { act: "support.send" },
};
/** What `tools/list` says about a tool, in the words the MCP specification gives those hints. */
export function annotationsOf(name) {
    const t = TOOL_TIERS[name];
    const tier = t === undefined || typeof t.act === "function" ? "low" : ACTS[t.act].tier;
    return {
        readOnlyHint: t?.readOnly === true,
        destructiveHint: tier === "high" || tier === "ultra-high",
        idempotentHint: t?.readOnly === true,
        openWorldHint: false,
    };
}
/** The sentence put in front of a tool's description, so the model knows the tier before calling. */
export function tierLine(tier) {
    switch (tier) {
        case "none":
            return "";
        case "low":
            return "Tier low: asked in the default mode, runs unasked in the auto modes. ";
        case "medium":
            return "Tier medium: asked in the default mode; in an auto mode it is your judgement whether this is what the person wants. ";
        case "high":
            return `Tier high: locked until a person runs \`${BINARY_NAME} unlock\` at a terminal, and asked every time in every mode but skip-permissions. `;
        case "ultra-high":
            return "Tier ultra-high: a person's act, in every mode. ";
    }
}
/** The refusal for a client that cannot be asked, and the way round it. */
export function cannotAsk(what) {
    return (`Refused: ${what} needs the person's yes in this mode, and this client cannot put a question in ` +
        `front of them. Ask them in your own words; once they agree, run the same thing with \`${BINARY_NAME}\` ` +
        `at the command line with --yes, or use a client that supports MCP elicitation. Nothing was done.`);
}
/** The refusal after the question was put and not agreed to. */
export const SAID_NO = "Refused: the person did not confirm it. Nothing was sent and nothing changed.";
/**
 * Run the tier gate for one tool call. Returns the refusal to hand back, or `null` to go ahead.
 *
 * ⛔ THE MODE AND THE ASKER ARE ARGUMENTS, NOT THINGS THIS READS, so every branch is tested for
 *    the answer it gives rather than for the machine the test runs on.
 */
export async function passTool(name, args, mode, ask, now = new Date()) {
    const t = TOOL_TIERS[name];
    if (t === undefined)
        return `Refused: ${name} has no tier. Nothing was done.`;
    const act = typeof t.act === "function" ? t.act(args) : t.act;
    const a = ACTS[act];
    if (a.tier === "none" || args["dry_run"] === true)
        return null;
    if (mode === "skip-permissions")
        return null;
    if (a.tier === "ultra-high")
        return `Refused: ${a.what ?? act} is a person's act, in every mode. Nothing was done.`;
    const what = a.what ?? `${name} does this.`;
    if ("lock" in a && !(await unlocked(a.lock, now))) {
        return (`Refused: ${what} It is locked on this machine. A person unlocks it at a terminal, once: ` +
            `\`${BINARY_NAME} unlock ${a.lock}\`. Do not run that yourself. Nothing was done.`);
    }
    const needsYes = a.tier === "high" ? !("standing" in a) : mode === "default";
    if (!needsYes)
        return null;
    if (ask === null)
        return cannotAsk(what);
    const outcome = await ask(t.question?.(args) ?? `${what} Go ahead?`);
    if (outcome === "unreachable")
        return cannotAsk(what);
    return outcome === "yes" ? null : SAID_NO;
}
/** Wrap the served tools: tier in the description, hints in the listing, the gate before each run. */
export function withTiers(tools, asker) {
    return tools.map((tool) => {
        const t = TOOL_TIERS[tool.name];
        const tier = t === undefined ? "low" : typeof t.act === "function" ? ACTS[t.act({})].tier : ACTS[t.act].tier;
        return {
            ...tool,
            description: `${tierLine(tier)}${tool.description}`,
            annotations: annotationsOf(tool.name),
            run: async (args) => (await passTool(tool.name, args, currentMode(), asker())) ?? (await tool.run(args)),
        };
    });
}
