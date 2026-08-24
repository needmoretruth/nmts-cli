// `nmts verify` — the one thing this tool needs done that it cannot do itself.
//
// ⛔ WHY THERE IS A COMMAND FOR SOMETHING THIS TOOL CANNOT DO. An API key makes the server answer,
//    and that is the whole of what it does. Behind the key the server keeps a second question —
//    has anybody checked lately that a person is behind this account — and when the answer is no
//    it does not stop the account, it makes it slower and closes the routes that hand out
//    something for nothing. The only way to answer that question is for a person to open a page
//    and type a short code. So this command asks the server for the code, prints it, and waits:
//    the doing is theirs, the waiting is ours, and saying it any other way would be a lie about
//    what a program can do.
//
// ⛔ THE CODE IS PRINTED ON PURPOSE, AND IT IS NOT THE ACCOUNT CODE. Everything else in this tool
//    refuses to put a credential on the screen. This one is minted to be read out: it is single
//    use, it stops working within minutes, the server keeps only a hash of it, and by itself it
//    opens nothing — a person still has to pass the check on the page. The account code is a
//    different thing entirely and still never appears here, which the text says out loud so that
//    nobody reads "type this code" and reaches for the wrong one.
//
// ⛔ IT PRINTS THE MOMENT THE CHECK ENDS, NOT A NUMBER OF DAYS. The window is counted in the
//    server's own weeks, so it ends on a week boundary rather than a fixed span after the code was
//    typed: somebody who verifies ten minutes before that boundary gets ten minutes. There is no
//    special case for that in the server and there should not be one here — a second clock is how
//    two answers to one question start. The honest thing is the absolute moment, and then whoever
//    is reading decides.
//
// ⚠ IT NEEDS THE API KEY AND NOT THE ACCOUNT CODE. Nothing here opens a file, so demanding the
//   code would refuse a run over a credential the command never uses.
import { request } from "../api.js";
import { readCredentialsFile } from "../credentials.js";
import { NmtsError } from "../errors.js";
import { BINARY_NAME } from "../product.js";
import { resolveServer } from "../server.js";
import { requireApiKey } from "../session.js";
/**
 * How long to wait between asks when the server does not say.
 *
 * ⛔ AND THE BOUNDS AROUND WHAT IT DOES SAY. The interval arrives from the server, which makes it
 *    data — and a loop that takes its own timing from data is a loop somebody else controls. Zero
 *    would be a hot loop against the server; an hour would outlive the code and look like a hang.
 */
const DEFAULT_POLL_SECS = 5;
const MIN_POLL_MS = 1_000;
const MAX_POLL_MS = 60_000;
export async function verify(options = {}) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    const quiet = options.json === true;
    const human = (line) => {
        if (!quiet)
            say(line);
    };
    const apiKey = requireApiKey();
    const stored = readCredentialsFile();
    const server = resolveServer(options.server ?? stored?.server);
    // ⛔ THE QUESTION IS ASKED BEFORE ANY CODE IS MADE, and that ordering is the point. Minting is
    //    not free: it spends a small daily allowance, it replaces whatever code was outstanding, and
    //    above all it interrupts a person. An agent that runs this command whenever a request was
    //    refused would otherwise fetch a human being for an account that is already verified.
    const standing = await ask(server, apiKey);
    if (options.status === true) {
        if (quiet) {
            say(JSON.stringify({ verified: standing.verified, roundKey: standing.roundKey, verifiedUntil: standing.until?.iso ?? null }));
            return 0;
        }
        sayStanding(say, standing);
        return 0;
    }
    if (standing.verified) {
        if (quiet) {
            sayResult(say, standing, false);
            return 0;
        }
        say(`Already verified${standing.until === null ? "" : ` until ${standing.until.iso} (${inWords(standing.until.ms - Date.now())})`}.`);
        say(``);
        say(`  No code was made and nobody has to be interrupted. Run this again after that`);
        say(`  moment to renew the check.`);
        return 0;
    }
    // ⛔ THE ADDRESS IS WRITTEN OUT AT EVERY CALL RATHER THAN HELD IN A CONSTANT, and that is the
    //    opposite of the usual advice for a reason: the gate that checks this tool's addresses
    //    against the server's own routes reads the literal in the call. A constant here compiles,
    //    reads better, and makes that check silently stop looking at this command — which is worse
    //    than the repetition. The two halves of this share one address, told apart by the method.
    const minted = readMinted(await request(server, "/v1/agent/verify", { method: "POST", token: apiKey, body: {} }));
    if (quiet) {
        say(JSON.stringify({ event: "code", code: minted.code, verifyUrl: minted.verifyUrl, expiresAt: minted.expiresAt.iso, pollAfterSecs: Math.round(minted.pollMs / 1000) }));
    }
    // ⚠ ADDRESSED TO WHOEVER IS RUNNING THIS, WHICH IS OFTEN A PROGRAM. It says what has to happen
    //   and who has to do it, and it does not pretend that the tool has any way to do it instead.
    human(`A person has to finish this at a browser. Nothing here can do it for them — what`);
    human(`is being checked is that somebody is there.`);
    human(``);
    human(`  Ask the person to open   ${minted.verifyUrl}`);
    human(`  and to type this code    ${minted.code}`);
    human(``);
    human(`This is not the account code. It works once, and it stops working at`);
    human(`${minted.expiresAt.iso} (${inWords(minted.expiresAt.ms - Date.now())}).`);
    human(``);
    human(`Waiting here until it is used. Ctrl-C stops the waiting, not the code.`);
    const wait = options.sleep ?? waitFor;
    const controller = new AbortController();
    const stop = () => controller.abort();
    // ⛔ THE INTERRUPT KEY IS CAUGHT RATHER THAN LEFT TO END THE PROCESS. This command is the one
    //    that waits, so it is the one where somebody presses Ctrl-C — and what they get for it
    //    should be the tool's own cancelled code and a line saying the code they were given is still
    //    good, not a killed process and no explanation. The handler is removed again below: a
    //    listener that outlives the wait would swallow the next interrupt too.
    process.on("SIGINT", stop);
    if (options.signal !== undefined) {
        if (options.signal.aborted)
            controller.abort();
        else
            options.signal.addEventListener("abort", stop, { once: true });
    }
    try {
        while (Date.now() < minted.expiresAt.ms) {
            // Never sleep past the moment the code dies: the last ask belongs to the person who typed
            // it with seconds to spare.
            const left = minted.expiresAt.ms - Date.now();
            await wait(Math.min(minted.pollMs, Math.max(left, 0)), controller.signal);
            stopIfCancelled(controller.signal, minted.expiresAt);
            const now = await askDuring(server, apiKey, controller.signal, minted.expiresAt);
            if (now.verified) {
                if (quiet) {
                    sayResult(say, now, false);
                }
                else {
                    say(``);
                    sayVerified(say, now);
                }
                return 0;
            }
        }
    }
    finally {
        process.off("SIGINT", stop);
        // The caller's signal is the caller's: nothing of ours stays attached to it after this returns.
        options.signal?.removeEventListener("abort", stop);
    }
    if (quiet)
        sayResult(say, standing, true);
    throw new NmtsError(`The code stopped working before anybody used it.`, {
        exitCode: 1,
        nextStep: `Nothing was verified and nothing was spent. Run \`${BINARY_NAME} verify\` again when the ` +
            `person is ready to open the page and type the code it prints.`,
    });
}
/** ⛔ ONE PLACE DECIDES WHAT CANCELLING MEANS, whichever await was interrupted. */
function stopIfCancelled(signal, expiresAt) {
    if (!signal.aborted)
        return;
    throw new NmtsError(`Cancelled.`, {
        exitCode: 130,
        nextStep: `The code is still good until ${expiresAt.iso}, so a person who types it after this still ` +
            `passes the check. \`${BINARY_NAME} verify --status\` says whether they did.`,
    });
}
/** Ask the server about the standing check. */
async function ask(server, apiKey) {
    return readStanding(await request(server, "/v1/agent/verify", { token: apiKey }));
}
/**
 * The same ask, made while a wait can be cancelled.
 *
 * ⛔ AN ABORTED REQUEST IS NOT A BROKEN SERVER. Without this, pressing Ctrl-C mid-request surfaces
 *    as "the server did not answer" — a message that sends a reader to look at the network for a
 *    thing they did themselves.
 */
async function askDuring(server, apiKey, signal, expiresAt) {
    try {
        return readStanding(await request(server, "/v1/agent/verify", { token: apiKey, signal }));
    }
    catch (error) {
        stopIfCancelled(signal, expiresAt);
        throw error;
    }
}
function sayStanding(say, standing) {
    if (standing.verified) {
        sayVerified(say, standing);
        return;
    }
    say(`Not verified.`);
    say(``);
    say(`  Until somebody passes the check, this account's key works under tighter limits and`);
    say(`  some requests are refused outright.`);
    say(``);
    say(`  \`${BINARY_NAME} verify\` prints a short code for a person to type at a browser.`);
    say(`  Nothing here can pass the check without them.`);
}
function sayVerified(say, standing) {
    const week = standing.roundKey === null ? `` : ` Week ${standing.roundKey}.`;
    if (standing.until === null) {
        say(`Verified.${week}`);
        return;
    }
    say(`Verified until ${standing.until.iso} (${inWords(standing.until.ms - Date.now())}).${week}`);
    say(``);
    say(`  That moment is a boundary of the server's own weeks, not a fixed span from now, so`);
    say(`  a check passed just before one ends is a short one.`);
}
/** The machine-readable end of a run that waited. `codeExpired` says which of the two ways it ended. */
function sayResult(say, standing, codeExpired) {
    say(JSON.stringify({
        event: "result",
        verified: standing.verified,
        roundKey: standing.roundKey,
        verifiedUntil: standing.until?.iso ?? null,
        codeExpired,
    }));
}
/** One field of a server answer, or null when it is absent or the wrong type. */
function stringField(source, field) {
    if (typeof source !== "object" || source === null)
        return null;
    const value = Reflect.get(source, field);
    return typeof value === "string" && value.length > 0 ? value : null;
}
function numberField(source, field) {
    if (typeof source !== "object" || source === null)
        return null;
    const value = Reflect.get(source, field);
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function booleanField(source, field) {
    if (typeof source !== "object" || source === null)
        return null;
    const value = Reflect.get(source, field);
    return typeof value === "boolean" ? value : null;
}
/**
 * An instant, normalised to UTC.
 *
 * ⛔ UTC AND NOTHING ELSE. The window is decided in the server's calendar; printing a local time
 *    would make two machines in different places disagree about when the same moment is.
 */
function momentOf(raw) {
    if (raw === null)
        return null;
    const ms = Date.parse(raw);
    if (Number.isNaN(ms))
        return null;
    return { iso: new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z"), ms };
}
/**
 * The address a person will be told to open — refused unless it is one a browser can trust.
 *
 * ⛔ THIS IS THE ONE PLACE THIS TOOL ASKS A HUMAN BEING TO GO SOMEWHERE. Everything else it prints
 *    is about files. The address arrives from whatever server `--server` names, so a run pointed
 *    at the wrong host by a stale config or a helpful agent could hand somebody a link to type a
 *    code into — and the person reading it has no way to tell it apart from ours. `https` is the
 *    floor; loopback over plain http is allowed because that is the development stack and it is
 *    not somewhere a stranger can stand.
 */
function trustedUrl(raw) {
    if (raw === null)
        return null;
    let parsed;
    try {
        parsed = new URL(raw);
    }
    catch {
        return null;
    }
    if (parsed.protocol === "https:")
        return raw;
    const loopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "[::1]";
    return parsed.protocol === "http:" && loopback ? raw : null;
}
function readMinted(answer) {
    const code = stringField(answer, "code");
    const verifyUrl = trustedUrl(stringField(answer, "verify_url"));
    const expiresAt = momentOf(stringField(answer, "expires_at"));
    if (code === null || verifyUrl === null || expiresAt === null) {
        throw brokenAnswer("a code, an address a browser can trust to type it at, and when it stops working");
    }
    // ⛔ A MISSING INTERVAL IS NOT A REASON TO REFUSE — there is a sane one here. A missing DEADLINE
    //    is, because without it the waiting has no end and a hang is worse than a failure.
    const seconds = numberField(answer, "poll_after_secs") ?? DEFAULT_POLL_SECS;
    const pollMs = Math.min(Math.max(seconds * 1000, MIN_POLL_MS), MAX_POLL_MS);
    return { code, verifyUrl, expiresAt, pollMs };
}
function readStanding(answer) {
    const verified = booleanField(answer, "verified");
    if (verified === null)
        throw brokenAnswer("whether this account is verified");
    return {
        verified,
        roundKey: stringField(answer, "round_key"),
        until: momentOf(stringField(answer, "verified_until")),
    };
}
/** ⚠ The answer's own contents are never quoted back: it came from the network, and it goes in a log. */
function brokenAnswer(wanted) {
    return new NmtsError(`The server's answer did not carry ${wanted}.`, {
        exitCode: 1,
        nextStep: `This version of \`${BINARY_NAME}\` and that server do not agree about this. Update the tool, or check --server.`,
    });
}
/**
 * A gap in words, coarse on purpose.
 *
 * ⚠ Rounded, because the number beside it is exact. The absolute moment is what somebody acts on;
 *   this is only there so nobody has to subtract two timestamps in their head.
 */
function inWords(ms) {
    if (ms <= 0)
        return "already past";
    const minutes = Math.round(ms / 60_000);
    if (minutes < 1)
        return "in under a minute";
    if (minutes < 60)
        return `in ${minutes} minute${minutes === 1 ? "" : "s"}`;
    const hours = Math.round(ms / 3_600_000);
    if (hours < 48)
        return `in ${hours} hour${hours === 1 ? "" : "s"}`;
    return `in ${Math.round(ms / 86_400_000)} days`;
}
/** The default wait: a timer that gives up quietly the moment the run is cancelled. */
function waitFor(ms, signal) {
    if (signal.aborted)
        return Promise.resolve();
    return new Promise((resolve) => {
        const done = () => {
            clearTimeout(timer);
            signal.removeEventListener("abort", done);
            resolve();
        };
        const timer = setTimeout(done, ms);
        signal.addEventListener("abort", done, { once: true });
    });
}
