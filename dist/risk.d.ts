import type { ParsedArgs } from "./args.ts";
import type { ConsentKey } from "./consent.ts";
export type Tier = "none" | "low" | "medium" | "high" | "ultra-high";
export interface Act {
    tier: Tier;
    /** What the gate asks about, in the second person. Absent for `none`. */
    what?: string;
    /** The unlock this act sits behind. Only high acts have one. */
    lock?: ConsentKey;
    /**
     * The command prints its own review and takes its own yes (`--yes`, a typed sentence, a version
     * string). The gate then decides only whether a yes is NEEDED, and the command asks.
     */
    asksItself?: true;
    /**
     * The unlock is itself the standing consent, so a run under it is not asked again: wallet acts
     * under the `wallet` grant (scope, expiry, ceiling), and the two ways of keeping the code outside
     * the sealed file, where unlocking IS the decision the command carries out.
     */
    standing?: true;
}
export declare const ACTS: {
    readonly login: {
        readonly tier: "none";
    };
    readonly logout: {
        readonly tier: "none";
    };
    readonly whoami: {
        readonly tier: "none";
    };
    readonly ls: {
        readonly tier: "none";
    };
    readonly usage: {
        readonly tier: "none";
    };
    readonly balance: {
        readonly tier: "none";
    };
    readonly trial: {
        readonly tier: "none";
    };
    readonly expiring: {
        readonly tier: "none";
    };
    readonly losses: {
        readonly tier: "none";
    };
    readonly "public-code": {
        readonly tier: "none";
    };
    readonly wallet: {
        readonly tier: "none";
    };
    readonly get: {
        readonly tier: "none";
    };
    readonly pull: {
        readonly tier: "none";
    };
    readonly receive: {
        readonly tier: "none";
    };
    readonly shares: {
        readonly tier: "none";
    };
    readonly listfile: {
        readonly tier: "none";
    };
    readonly "recovery-list": {
        readonly tier: "none";
    };
    readonly recovery: {
        readonly tier: "none";
    };
    readonly mkdir: {
        readonly tier: "none";
    };
    readonly mv: {
        readonly tier: "none";
    };
    readonly rename: {
        readonly tier: "none";
    };
    readonly star: {
        readonly tier: "none";
    };
    readonly unstar: {
        readonly tier: "none";
    };
    readonly pin: {
        readonly tier: "none";
    };
    readonly unpin: {
        readonly tier: "none";
    };
    readonly label: {
        readonly tier: "none";
    };
    readonly unlabel: {
        readonly tier: "none";
    };
    readonly devices: {
        readonly tier: "none";
    };
    readonly key: {
        readonly tier: "none";
    };
    readonly env: {
        readonly tier: "none";
    };
    readonly mode: {
        readonly tier: "none";
    };
    readonly unlock: {
        readonly tier: "none";
    };
    readonly lock: {
        readonly tier: "none";
    };
    readonly consent: {
        readonly tier: "none";
    };
    readonly "on-collision": {
        readonly tier: "none";
    };
    readonly padding: {
        readonly tier: "none";
    };
    readonly deposit: {
        readonly tier: "none";
    };
    readonly notices: {
        readonly tier: "none";
    };
    readonly terms: {
        readonly tier: "none";
    };
    readonly privacy: {
        readonly tier: "none";
    };
    readonly verify: {
        readonly tier: "none";
    };
    readonly support: {
        readonly tier: "none";
    };
    readonly mcp: {
        readonly tier: "none";
    };
    readonly "accept-terms": {
        readonly tier: "none";
    };
    readonly rm: {
        readonly tier: "low";
        readonly what: "Move these to the trash, restorable for 30 days.";
    };
    readonly restore: {
        readonly tier: "low";
        readonly what: "Bring these back out of the trash.";
    };
    readonly unshare: {
        readonly tier: "low";
        readonly what: "Withdraw this share. Whoever had it cannot download it again.";
    };
    readonly tip: {
        readonly tier: "none";
    };
    readonly "tip.set": {
        readonly tier: "none";
    };
    readonly "on-collision.set": {
        readonly tier: "low";
        readonly what: "Change what an upload does when its name is already taken.";
    };
    readonly "padding.set": {
        readonly tier: "low";
        readonly what: "Change how file sizes are hidden for the next uploads.";
    };
    readonly "deposit.set": {
        readonly tier: "low";
        readonly what: "Change how many credits the next uploads set aside as a deposit.";
    };
    readonly update: {
        readonly tier: "low";
        readonly what: "Replace this program with the newest published release.";
    };
    readonly "trial.apply": {
        readonly tier: "low";
        readonly what: "Ask for this week's free credits.";
    };
    readonly "support.send": {
        readonly tier: "low";
        readonly what: "Send this message to the developer of NMTS.";
        readonly asksItself: true;
    };
    readonly s3: {
        readonly tier: "medium";
        readonly what: "Serve the drive to S3 programs on this machine. Uploads through it spend credits.";
    };
    readonly put: {
        readonly tier: "medium";
        readonly what: "Upload this file and spend credits on its storage. Credits are not refundable.";
    };
    readonly push: {
        readonly tier: "medium";
        readonly what: "Upload this directory and spend credits on its storage. Credits are not refundable.";
    };
    readonly sweep: {
        readonly tier: "medium";
        readonly what: "Drop trash entries whose 30 days have run out.";
        readonly asksItself: true;
    };
    readonly "key.list": {
        readonly tier: "none";
    };
    readonly "key.new": {
        readonly tier: "medium";
        readonly what: "Make a new API key for this machine.";
    };
    readonly "key.revoke": {
        readonly tier: "medium";
        readonly what: "Revoke an API key. Whatever used it stops working.";
    };
    readonly "public-code.publish": {
        readonly tier: "medium";
        readonly what: "Publish this account's public code. Publishing cannot be undone.";
    };
    readonly "losses.dismiss": {
        readonly tier: "medium";
        readonly what: "Put this loss notice down. It will not be shown again.";
    };
    readonly rebuild: {
        readonly tier: "medium";
        readonly what: "Build a file list from the server's rows and write it as this account's list.";
    };
    readonly share: {
        readonly tier: "high";
        readonly lock: "share";
        readonly what: "Give another account this file.";
        readonly asksItself: true;
    };
    readonly "login.plain": {
        readonly tier: "high";
        readonly lock: "unsafe-code-storage";
        readonly what: "Store the NMTS key in the clear.";
        readonly standing: true;
    };
    readonly "login.env": {
        readonly tier: "high";
        readonly lock: "plain-env";
        readonly what: "Print the NMTS key for an environment variable.";
        readonly standing: true;
    };
    readonly extend: {
        readonly tier: "high";
        readonly lock: "wallet";
        readonly what: "Sign a transaction that spends WAL from the wallet.";
        readonly standing: true;
    };
    readonly "put.wallet": {
        readonly tier: "high";
        readonly lock: "wallet";
        readonly what: "Sign a transaction that spends WAL and SUI from the wallet.";
        readonly standing: true;
    };
    readonly "push.wallet": {
        readonly tier: "high";
        readonly lock: "wallet";
        readonly what: "Sign transactions that spend WAL and SUI from the wallet.";
        readonly standing: true;
    };
    readonly "wallet.send": {
        readonly tier: "high";
        readonly lock: "wallet";
        readonly what: "Send coins out of the wallet.";
        readonly asksItself: true;
    };
    readonly "wallet.swap": {
        readonly tier: "high";
        readonly lock: "wallet";
        readonly what: "Swap one coin for the other on a public venue.";
        readonly asksItself: true;
    };
    readonly "devices.sign-out": {
        readonly tier: "high";
        readonly lock: "sign-out";
        readonly what: "Sign a device out of this account.";
        readonly asksItself: true;
    };
    readonly rollback: {
        readonly tier: "high";
        readonly lock: "rollback";
        readonly what: "Put the previous file list back in place of the current one.";
        readonly asksItself: true;
    };
    readonly "whoami.reveal": {
        readonly tier: "high";
        readonly lock: "reveal";
        readonly what: "Print the NMTS key on this screen.";
    };
    readonly kit: {
        readonly tier: "high";
        readonly lock: "kit";
        readonly what: "Write the NMTS key into a recovery kit file on this disk.";
    };
    readonly create: {
        readonly tier: "high";
        readonly what: "Create a new account under the Terms in force.";
        readonly asksItself: true;
    };
    readonly "accept-terms.accept": {
        readonly tier: "high";
        readonly what: "Accept a new version of the Terms for this account.";
        readonly asksItself: true;
    };
    readonly "delete-account": {
        readonly tier: "ultra-high";
        readonly what: "Erase this account's server record, permanently.";
        readonly asksItself: true;
    };
    readonly erase: {
        readonly tier: "ultra-high";
        readonly what: "Erase files for good: the server's record and this account's key to them.";
        readonly asksItself: true;
    };
    readonly "erase.release": {
        readonly tier: "ultra-high";
        readonly lock: "release-storage";
        readonly what: "Erase files for good AND destroy the storage bought with credits under them.";
        readonly asksItself: true;
    };
    readonly "wallet.donate": {
        readonly tier: "high";
        readonly lock: "donate";
        readonly what: "Send a gift to the developer from the wallet.";
        readonly asksItself: true;
    };
    readonly "wallet.hall": {
        readonly tier: "none";
    };
    readonly "wallet.hall.set": {
        readonly tier: "medium";
        readonly what: "Publish this name beside your wallet's address in the gift hall of fame.";
    };
    readonly "wallet.storage.reshape": {
        readonly tier: "high";
        readonly lock: "wallet";
        readonly what: "Cut or join a storage resource the wallet holds — a signed transaction.";
        readonly asksItself: true;
    };
    readonly "wallet.storage.give": {
        readonly tier: "high";
        readonly lock: "wallet";
        readonly what: "Hand a storage resource to another address — signed, and not undoable.";
        readonly asksItself: true;
    };
};
export type ActId = keyof typeof ACTS;
export declare const ACT_IDS: ActId[];
/**
 * Which act this command line performs. `null` only for a command the entry point does not know,
 * which it refuses on its own.
 */
export declare function actOf(args: ParsedArgs): ActId | null;
/**
 * The hook `main.ts` calls once per run: find the act, pass it through the gate, and when the
 * gate itself has taken the yes, hand the command a `--yes` so it does not ask twice.
 * ⚠ The gate is loaded only when there is an act: this file is on every run's path
 *    (`check:cli-startup`), and the gate reaches the consent and prompt modules.
 */
export declare function gateArgs(args: ParsedArgs): Promise<void>;
