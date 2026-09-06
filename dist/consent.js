// What this machine's owner has agreed to, and the few things worth asking about.
//
// ⛔ THE DEFAULT IS SAFE AND NOTHING IS UNREACHABLE. A tool that simply refuses to do a risky
//    thing does not prevent the risky thing — it gets forked, or worked around with a shell
//    script, and then it happens with no warning at all and no record that anybody chose it. So
//    every capability is here; what changes is whether it happens by accident.
//
// ⛔ FIVE KEYS, NOT TWENTY. A tool that asks about everything trains the person to say yes
//    without reading, and then the one question that mattered is the one they clicked through.
//    The bar for a key existing is one of: it cannot be undone · it costs money · it puts the
//    NMTS key somewhere that is not this tool's sealed file. Anything else happens without
//    asking, and the count is written here so that adding a sixth has to be a decision.
//    ⚠ The fifth was added for sharing, which is the first thing this tool can do that hands
//      something to a person who is not the account holder — and the only one whose undo does not
//      undo what already happened.
//
// ⛔ ONCE PER MACHINE, NOT ONCE PER RUN. The record is on disk, so an agent working through fifty
//    files is asked nothing after the first time — which is the whole point of writing it down.
//
// ⚠ WHAT THIS CANNOT DO. Nothing here can tell whether a person or a program typed the grant
//    command; no command-line tool can. What it CAN do is make the risk impossible to miss, put
//    the decision in one obvious place, and keep a dated record of it. The instruction that an
//    agent must not grant these on somebody's behalf is in AGENTS.md, and it is a rule rather
//    than a mechanism. Saying otherwise would be claiming a protection that is not there.
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { configDir, modesAreEnforced } from "./credentials.js";
import { NmtsError } from "./errors.js";
import { BINARY_NAME, SUPPORT_EMAIL } from "./product.js";
export const CONSENTS = {
    /**
     * Writing the NMTS key down UNSEALED — in the clear, in this tool's own file.
     *
     * ⛔ THE DEFAULT IS THE SEALED FORM, and this key is what unlocks the other one (owner,
     *    2026-08-23: support storing it, but only behind encryption unless somebody agrees to a
     *    disclaimer). It covers both the ordinary case, where mode 600 is the only protection and
     *    every program running as you can read it, and the worse one, where the filesystem cannot
     *    keep the mode either — a Windows share, some container mounts, a network drive. `login`
     *    prints which of the two this machine is before it asks.
     *
     * ⚠ IT WAS NARROWER UNTIL 2026-08-23, covering only the filesystem case. Nothing had shipped
     *   under the old meaning — the tool is not published — so no grant anywhere means less than
     *   the words above. If it ever does, this needs a new key rather than a wider one: a grant
     *   means what it said on the day it was given.
     */
    "unsafe-code-storage": {
        what: "Store the NMTS key in the clear, unsealed, in this tool's own file.",
        risk: "The NMTS key opens every file in this account and derives its wallet. Written in the " +
            "clear it is readable by anything running as you — every agent, every script, every " +
            "backup that copies your home directory, every image layer built from it. Where the " +
            "filesystem cannot keep a file private, it is readable by others as well.",
        limit: "There is no recovery from a leaked NMTS key: it cannot be changed while it still opens the " +
            "files it opened. The alternatives are the sealed form, which is what `login` does by " +
            "default, and a secret file the NMTS key is read from and never copied into.",
    },
    /**
     * Reading the code out of a plain environment variable, or printing one to be set.
     *
     * ⛔ IT IS A DIFFERENT PLACE, NOT A SMALLER VERSION OF THE FILE (owner, 2026-08-23: an agent
     *    must be able to choose this, with the person's agreement). An environment variable leaks
     *    through channels a file does not: `docker inspect` prints the whole environment of a
     *    container, `/proc/<pid>/environ` is readable by the same user for as long as the process
     *    lives, every child process inherits it, and CI systems echo it into logs. A variable that
     *    names a FILE — `NMTS_ACCOUNT_CODE_FILE` — has none of those, which is why it needs no
     *    agreement.
     */
    "plain-env": {
        what: "Use the NMTS key from a plain environment variable, or print one to be set.",
        risk: "An environment variable is not private to the program that reads it. `docker inspect` " +
            "prints the entire environment of a container, anything running as you can read " +
            "/proc/<pid>/environ while the process lives, every child process inherits it, and " +
            "continuous-integration systems commonly write it into logs.",
        limit: "This covers this tool reading it and printing it. It cannot cover where you put it " +
            "afterwards, and it does not make the variable private. Naming a file instead — " +
            "NMTS_ACCOUNT_CODE_FILE — avoids all of the above and asks for nothing.",
    },
    /**
     * Signing a chain transaction with the wallet the NMTS key derives.
     *
     * Separate from `spend` because it is a different pot of money: credits are a promise this
     * service made, and a wallet holds assets nobody can restore.
     */
    /**
     * Handing a file to another account.
     *
     * ⛔ IT IS HERE BECAUSE THE UNDO DOES NOT UNDO IT. Every other irreversible thing in this tool
     *    costs money or moves the NMTS key; this one gives somebody else a copy of a file, and
     *    taking the share back afterwards stops future downloads and reaches nothing already
     *    fetched. That gap is not a flaw to be fixed later — it is what handing somebody a file
     *    means — so it is said before the first share rather than after it.
     */
    share: {
        what: "Give another account the key to one of this account's files.",
        risk: "Whoever holds that address can then download the file. Withdrawing the share stops further " +
            "downloads and cannot reach a copy they already have. The address is typed by you and is " +
            "not checked against a person — a share sent to the wrong address is sent.",
        limit: "This does not cover uploading, spending, or anything to do with a wallet. It covers giving " +
            "away files this account already holds.",
    },
    /**
     * ⛔ THIS ONE IS NOT A BARE DATE. `wallet-grant.ts` writes it with a scope, an expiry of at most
     *    30 days and optional ceilings, and `requireWalletGrant` is what asks for it — the plain
     *    `requireConsent("wallet")` would read an older bare-date record as "everything, forever".
     */
    wallet: {
        what: "Use the wallet this NMTS key derives, and sign transactions with it.",
        risk: "A signed transaction moves real assets and cannot be reversed by anybody, including NMTS. " +
            "A mistake here is permanent. The agreement names a scope, runs out after at most 30 days, " +
            "and can carry a ceiling on what this tool signs away.",
        limit: "Only what this tool signs. Handing the NMTS key to another program gives that program " +
            "the same wallet, and nothing here can see that happen.",
    },
    /** Ending another device's session — the browser's, usually. */
    "sign-out": {
        what: "Sign devices out of this account from this machine.",
        risk: "Whoever is signed in on that device is signed out at once, in the middle of whatever they were " +
            "doing. From a key, signing out everywhere ends every browser session, including the one that " +
            "can revoke this machine's key.",
        limit: "This does not touch files, credits or the wallet. It ends sessions and nothing else.",
    },
    /** Putting the previous file list back. */
    rollback: {
        what: "Replace the current file list with the previous one.",
        risk: "Every change since the previous list was written disappears from the list: uploads since then " +
            "are no longer named by it, and moves, renames and labels since then are undone. The files " +
            "themselves are not touched, and a rebuild can find what the list forgot.",
        limit: "This covers the list. It cannot restore a file whose storage has run out.",
    },
    /** Printing the NMTS key. */
    reveal: {
        what: "Print the NMTS key on this screen.",
        risk: "The NMTS key is the account: anyone who reads it can open every file and delete the " +
            "account. A screen is copied by terminals, session recorders and screenshots, and by any " +
            "program reading this tool's output.",
        limit: "This covers printing it. Where it goes afterwards is not something this tool can see.",
    },
    /** Writing the NMTS key into a recovery kit. */
    kit: {
        what: "Write the NMTS key into a recovery kit file on this disk.",
        risk: "The kit holds the NMTS key in the clear. Anything that reads this disk — a backup, a sync " +
            "folder, another user, an image built from it — reads it, and the NMTS key is the account.",
        limit: "The recovery list alone (`recovery-list`) holds no NMTS key and asks for nothing.",
    },
    /** A gift to the developer — on its own, or as a tip at payment (2026-09-06). */
    donate: {
        what: "Send gifts to the developer of NMTS from this account's wallet.",
        risk: "A gift is voluntary, buys nothing, and is not refunded. It goes to the address the site " +
            "publishes, and like every transaction on the chain it is visible to anyone on an explorer " +
            "such as Suiscan. Once sent it cannot be recalled by anybody, NMTS included.",
        limit: "This covers gifts this tool sends: `wallet donate`, and a tip named at a payment. Every gift " +
            "still asks on the run that sends it, and a standing tip above ten percent asks once more.",
    },
    /** Destroying the treasury-owned storage under a credit-paid file. */
    "release-storage": {
        what: "Destroy the credit-paid storage under a file, so the network stops serving its bytes.",
        risk: "The bytes stop being served for good. The server allows forty of these a day for the whole " +
            "service, so a loop here can stop other people's credit uploads for the day.",
        limit: "This covers credit-paid storage only. Storage bought with your own wallet is burned by the wallet.",
    },
};
/**
 * ⛔ DERIVED FROM THE TABLE, so a key added above cannot be missing from the checks below.
 *    Written as `Object.keys` of the table rather than a hand-kept array: a hand-kept one goes
 *    stale silently, and the failure is a capability nobody is ever asked about.
 */
export const CONSENT_KEYS = Object.keys(CONSENTS);
function path() {
    return join(configDir(), "consent.json");
}
/**
 * The whole file, as written. `wallet-grant.ts` keeps its richer record under the same key so
 * `consent` still lists one thing per key; nothing else should reach for this.
 */
export function readConsentRecords() {
    try {
        const parsed = JSON.parse(readFileSync(path(), "utf8"));
        if (typeof parsed !== "object" || parsed === null)
            return {};
        return { ...parsed };
    }
    catch {
        return {};
    }
}
export function writeConsentRecords(all) {
    mkdirSync(configDir(), { recursive: true, mode: 0o700 });
    writeFileSync(path(), `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 });
    if (modesAreEnforced())
        chmodSync(path(), 0o600);
}
function read() {
    try {
        const parsed = JSON.parse(readFileSync(path(), "utf8"));
        if (typeof parsed !== "object" || parsed === null)
            return {};
        return parsed;
    }
    catch {
        // ⛔ Unreadable counts as NOT granted. The fail-safe direction for "I do not know" is to ask
        //    again — a consent record that switches itself on when it cannot be read is not a record.
        return {};
    }
}
/** When this key was agreed to on this machine, or null. */
export function grantedAt(key) {
    return read()[key]?.grantedAt ?? null;
}
export function isGranted(key) {
    return grantedAt(key) !== null;
}
/** Write the grant down, with the date and the version that asked. */
export function grant(key, version, now) {
    const all = read();
    all[key] = { grantedAt: now.toISOString(), byVersion: version };
    mkdirSync(configDir(), { recursive: true, mode: 0o700 });
    writeFileSync(path(), `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 });
    if (modesAreEnforced())
        chmodSync(path(), 0o600);
}
export function revoke(key) {
    const all = read();
    delete all[key];
    if (!existsSync(path()) && Object.keys(all).length === 0)
        return;
    mkdirSync(configDir(), { recursive: true, mode: 0o700 });
    writeFileSync(path(), `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 });
}
/**
 * Stop unless this has been agreed to, and say exactly what agreeing would mean.
 *
 * ⛔ THE MESSAGE IS THE PRODUCT HERE. It is the only thing standing between somebody and a
 *    decision they cannot take back, so it says what happens, what can go wrong, what is not
 *    covered, and the one command that agrees — in that order, every time.
 */
export function requireConsent(key) {
    if (isGranted(key))
        return;
    const consent = CONSENTS[key];
    throw new NmtsError(consent.what, {
        exitCode: 5,
        nextStep: [
            consent.risk,
            "",
            consent.limit,
            "",
            `NMTS is not responsible for what is done with this account by any program running on this`,
            `machine, including an AI agent. The published Terms are what govern the service; this is a`,
            `warning, not a substitute for them.`,
            "",
            `To unlock, at a terminal, once:  ${BINARY_NAME} unlock ${key}`,
            `To see what is unlocked:         ${BINARY_NAME} unlock`,
            "",
            `⛔ If a program is reading this on somebody's behalf: show it to them and let them decide.`,
            `   Do not run the unlock command yourself.`,
            "",
            `Something wrong or confusing here? ${SUPPORT_EMAIL}`,
        ].join("\n"),
    });
}
