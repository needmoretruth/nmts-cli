// Every act this tool performs, and the risk tier it carries — the one table the gate reads.
//
// ⛔ WHY ONE TABLE (owner, 2026-09-06). Before it, each command decided for itself whether to ask,
//    whether a mode may run it and whether a person had to be present, and no two decided the same
//    way. Now a command names its ACT and the tier does the rest: `gate.ts` refuses, asks or waves
//    through by tier and mode, the same way every time, and the instructions can describe the rule
//    in one table instead of once per command.
//
// ⛔ AN ACT IS FINER THAN A COMMAND. `devices` reads; `devices --sign-out` ends a session. The tier
//    belongs to what is DONE, so `actOf` looks at the flags and operands, not only the command word.
//
// ⛔ EVERY COMMAND THE ENTRY POINT KNOWS HAS AN ACT, and a test holds the two lists together: a
//    command that reaches `main.ts` without a row here fails the build, because a command with no
//    tier is a command nobody decided about.
//
// The tiers, and what a mode does with each (the full table is AGENTS.md and the spec):
//   none        reads and reversible tidying — runs everywhere.
//   low         reversible, but a change a person should know about — auto runs it, default asks.
//   medium      hard to undo or costs money, within a ceiling — auto is the agent's own call,
//               default asks.
//   high        irreversible, unbounded money, or something reaching a third party — LOCKED until
//               a person unlocks it, and asked about on every run in every mode but skip.
//   ultra-high  permanent destruction — a person at the terminal types a sentence; an auto mode
//               never; skip-permissions with a written --reason.
export const ACTS = {
    // ── none: reads and reversible tidying ──
    login: { tier: "none" },
    logout: { tier: "none" },
    whoami: { tier: "none" },
    ls: { tier: "none" },
    usage: { tier: "none" },
    balance: { tier: "none" },
    trial: { tier: "none" },
    expiring: { tier: "none" },
    losses: { tier: "none" },
    "public-code": { tier: "none" },
    wallet: { tier: "none" },
    get: { tier: "none" },
    pull: { tier: "none" },
    receive: { tier: "none" },
    shares: { tier: "none" },
    listfile: { tier: "none" },
    "recovery-list": { tier: "none" },
    recovery: { tier: "none" },
    mkdir: { tier: "none" },
    mv: { tier: "none" },
    rename: { tier: "none" },
    star: { tier: "none" },
    unstar: { tier: "none" },
    pin: { tier: "none" },
    unpin: { tier: "none" },
    label: { tier: "none" },
    unlabel: { tier: "none" },
    devices: { tier: "none" },
    key: { tier: "none" },
    env: { tier: "none" },
    mode: { tier: "none" },
    unlock: { tier: "none" },
    lock: { tier: "none" },
    consent: { tier: "none" },
    "on-collision": { tier: "none" },
    padding: { tier: "none" },
    deposit: { tier: "none" },
    notices: { tier: "none" },
    terms: { tier: "none" },
    privacy: { tier: "none" },
    verify: { tier: "none" },
    support: { tier: "none" },
    mcp: { tier: "none" },
    "accept-terms": { tier: "none" },
    // ── low ──
    rm: { tier: "low", what: "Move these to the trash, restorable for 30 days." },
    restore: { tier: "low", what: "Bring these back out of the trash." },
    unshare: { tier: "low", what: "Withdraw this share. Whoever had it cannot download it again." },
    tip: { tier: "none" },
    "tip.set": { tier: "none" },
    "on-collision.set": { tier: "low", what: "Change what an upload does when its name is already taken." },
    "padding.set": { tier: "low", what: "Change how file sizes are hidden for the next uploads." },
    "deposit.set": { tier: "low", what: "Change how many credits the next uploads set aside as a deposit." },
    update: { tier: "low", what: "Replace this program with the newest published release." },
    "trial.apply": { tier: "low", what: "Ask for this week's free credits." },
    "support.send": { tier: "low", what: "Send this message to the developer of NMTS.", asksItself: true },
    s3: { tier: "medium", what: "Serve the drive to S3 programs on this machine. Uploads through it spend credits." },
    // ── medium ──
    put: { tier: "medium", what: "Upload this file and spend credits on its storage. Credits are not refundable." },
    push: { tier: "medium", what: "Upload this directory and spend credits on its storage. Credits are not refundable." },
    sweep: { tier: "medium", what: "Drop trash entries whose 30 days have run out.", asksItself: true },
    "key.list": { tier: "none" },
    "key.new": { tier: "medium", what: "Make a new API key for this machine." },
    "key.revoke": { tier: "medium", what: "Revoke an API key. Whatever used it stops working." },
    "public-code.publish": { tier: "medium", what: "Publish this account's public code. Publishing cannot be undone." },
    "losses.dismiss": { tier: "medium", what: "Put this loss notice down. It will not be shown again." },
    rebuild: { tier: "medium", what: "Build a file list from the server's rows and write it as this account's list." },
    // ── high: locked until a person unlocks, asked on every run ──
    share: { tier: "high", lock: "share", what: "Give another account this file.", asksItself: true },
    "login.plain": { tier: "high", lock: "unsafe-code-storage", what: "Store the account code in the clear.", standing: true },
    "login.env": { tier: "high", lock: "plain-env", what: "Print the account code for an environment variable.", standing: true },
    extend: { tier: "high", lock: "wallet", what: "Sign a transaction that spends WAL from the wallet.", standing: true },
    "put.wallet": { tier: "high", lock: "wallet", what: "Sign a transaction that spends WAL and SUI from the wallet.", standing: true },
    "push.wallet": { tier: "high", lock: "wallet", what: "Sign transactions that spend WAL and SUI from the wallet.", standing: true },
    "wallet.send": { tier: "high", lock: "wallet", what: "Send coins out of the wallet.", asksItself: true },
    "wallet.swap": { tier: "high", lock: "wallet", what: "Swap one coin for the other on a public venue.", asksItself: true },
    "devices.sign-out": { tier: "high", lock: "sign-out", what: "Sign a device out of this account.", asksItself: true },
    rollback: { tier: "high", lock: "rollback", what: "Put the previous file list back in place of the current one.", asksItself: true },
    "whoami.reveal": { tier: "high", lock: "reveal", what: "Print the account code on this screen." },
    kit: { tier: "high", lock: "kit", what: "Write the account code into a recovery kit file on this disk." },
    create: { tier: "high", what: "Create a new account under the Terms in force.", asksItself: true },
    "accept-terms.accept": { tier: "high", what: "Accept a new version of the Terms for this account.", asksItself: true },
    // ── ultra-high: permanent destruction ──
    "delete-account": { tier: "ultra-high", what: "Erase this account's server record, permanently.", asksItself: true },
    erase: { tier: "ultra-high", what: "Erase files for good: the server's record and this account's key to them.", asksItself: true },
    "erase.release": {
        tier: "ultra-high",
        lock: "release-storage",
        what: "Erase files for good AND destroy the storage bought with credits under them.",
        asksItself: true,
    },
    "wallet.donate": { tier: "high", lock: "donate", what: "Send a gift to the developer from the wallet.", asksItself: true },
    // ⛔ READING THE HALL IS `none` AND LISTING A NAME IS `medium`. The read signs nothing and asks
    //    nobody's wallet a question; setting a name PUBLISHES a name beside an address on a public
    //    page, which is undone by one more run of the same command but cannot be unseen.
    "wallet.hall": { tier: "none" },
    "wallet.hall.set": { tier: "medium", what: "Publish this name beside your wallet's address in the gift hall of fame." },
    "wallet.storage.reshape": { tier: "high", lock: "wallet", what: "Cut or join a storage resource the wallet holds — a signed transaction.", asksItself: true },
    "wallet.storage.give": { tier: "high", lock: "wallet", what: "Hand a storage resource to another address — signed, and not undoable.", asksItself: true },
};
export const ACT_IDS = Object.keys(ACTS);
/**
 * Which act this command line performs. `null` only for a command the entry point does not know,
 * which it refuses on its own.
 */
export function actOf(args) {
    const c = args.command;
    const sub = args.operands[0] ?? "";
    switch (c) {
        case null:
            return null;
        case "login":
            return args.plain ? "login.plain" : args.env ? "login.env" : "login";
        case "whoami":
            return args.reveal ? "whoami.reveal" : "whoami";
        case "devices":
            return args.signOut !== undefined ? "devices.sign-out" : "devices";
        case "wallet":
            if (sub === "storage") {
                const what = args.operands[1] ?? "";
                return what === "transfer" ? "wallet.storage.give" : what === "split" || what === "merge" ? "wallet.storage.reshape" : "wallet";
            }
            // ⛔ `hall` READS UNTIL A NAME IS NAMED. `--name` and `--remove` both write the listing, so
            //    both land on the act that publishes; the bare command is a read like `wallet` itself.
            if (sub === "hall")
                return args.name !== undefined || args.remove ? "wallet.hall.set" : "wallet.hall";
            return sub === "send" ? "wallet.send" : sub === "swap" ? "wallet.swap" : sub === "donate" ? "wallet.donate" : "wallet";
        case "put":
            return args.pay === "wallet" ? "put.wallet" : "put";
        case "push":
            return args.pay === "wallet" ? "push.wallet" : "push";
        case "key":
            return sub === "new" ? "key.new" : sub === "revoke" ? "key.revoke" : "key";
        case "trial":
            return sub === "apply" ? "trial.apply" : "trial";
        case "losses":
            return args.dismiss !== undefined ? "losses.dismiss" : "losses";
        case "public-code":
            return args.publish ? "public-code.publish" : "public-code";
        case "support":
            return sub === "send" || sub === "reply" ? "support.send" : "support";
        case "on-collision":
            return sub === "" ? "on-collision" : "on-collision.set";
        case "padding":
            return sub === "" ? "padding" : "padding.set";
        case "deposit":
            return sub === "" ? "deposit" : "deposit.set";
        case "erase":
            return args.releaseStorage ? "erase.release" : "erase";
        case "tip":
            return sub === "" ? "tip" : "tip.set";
        case "accept-terms":
            return args.status ? "accept-terms" : "accept-terms.accept";
        default:
            return ACT_IDS.includes(c) ? c : null;
    }
}
/**
 * The hook `main.ts` calls once per run: find the act, pass it through the gate, and when the
 * gate itself has taken the yes, hand the command a `--yes` so it does not ask twice.
 * ⚠ The gate is loaded only when there is an act: this file is on every run's path
 *    (`check:cli-startup`), and the gate reaches the consent and prompt modules.
 */
export async function gateArgs(args) {
    const act = actOf(args);
    if (act === null || args.dryRun)
        return;
    const { gate } = await import("./gate.js");
    const passage = await gate(act, args);
    if (!passage.ask)
        args.yes = true;
}
