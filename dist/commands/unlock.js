// `nmts unlock` — what this machine's owner has opened, and the one way to open more.
//
// ⛔ IT IS A COMMAND AND NOT A PROMPT. A yes/no question in the middle of another command cannot be
//    answered by anything that is not a terminal, which is most of the places this tool runs: a
//    container, a build step, an agent's subprocess. Making the unlock its own command means the
//    same answer works everywhere, is recorded with a date, and can be looked at afterwards.
//
// ⛔ A PERSON UNLOCKS, AT A TERMINAL. Opening a lock refuses when stdin is not a terminal — the way
//    an agent's subprocess usually arrives — and prints what the lock guards before it asks. The one
//    mode that may unlock without a terminal is skip-permissions: the person who turned it on said
//    nothing is to ask them. Locking again is one line from anywhere: the safe direction is never
//    harder than the risky one.
//
// `nmts consent` is the older name for the same thing and still works: `grant` is `unlock`, `revoke`
// is `lock`.
import { currentMode } from "../autonomy.js";
import { CONSENTS, CONSENT_KEYS, grant, grantedAt, revoke } from "../consent.js";
import { NmtsError } from "../errors.js";
import { BINARY_NAME, SUPPORT_EMAIL, VERSION } from "../product.js";
import { promptLine, stdinIsATerminal } from "../prompt.js";
import { coinAmount } from "../wallet.js";
import { parseWalletGrant, readWalletGrant, walletGrantState, writeWalletGrant } from "../wallet-grant.js";
function isKey(value) {
    return CONSENT_KEYS.includes(value);
}
function keyOrFail(raw) {
    if (raw === undefined || raw === "") {
        throw new NmtsError("Say which one.", { exitCode: 2, nextStep: `One of: ${CONSENT_KEYS.join(" · ")}` });
    }
    if (!isKey(raw)) {
        throw new NmtsError(`There is nothing called "${raw}" to unlock.`, {
            exitCode: 2,
            nextStep: `One of: ${CONSENT_KEYS.join(" · ")}`,
        });
    }
    return raw;
}
/** `unlock` · `lock` · the list. `action` is already normalised by the caller (`grant` → `unlock`). */
export async function unlock(action, target, options = {}) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    const now = options.now ?? (() => new Date());
    if (action === undefined || action === "" || action === "list") {
        if (options.json) {
            say(JSON.stringify(CONSENT_KEYS.map((key) => row(key, now()))));
            return 0;
        }
        for (const key of CONSENT_KEYS) {
            if (key === "wallet") {
                for (const line of walletLines(now()))
                    say(line);
                continue;
            }
            const at = grantedAt(key);
            say(`${at === null ? "  locked    " : "  unlocked  "}  ${key}`);
            say(`                ${CONSENTS[key].what}`);
            if (at !== null)
                say(`                unlocked on this machine ${at}`);
            say(``);
        }
        say(`  ${BINARY_NAME} unlock <name>    open one, at a terminal, once`);
        say(`  ${BINARY_NAME} lock <name>      close it again`);
        say(``);
        say(`  Unlocking here does not change what the published Terms say. NMTS is not responsible`);
        say(`  for what any program on this machine does with this account, an AI agent included.`);
        say(`  Something wrong or confusing? ${SUPPORT_EMAIL}`);
        return 0;
    }
    if (action === "unlock") {
        const key = keyOrFail(target);
        if (options.readLine === undefined && !stdinIsATerminal() && currentMode() !== "skip-permissions") {
            throw new NmtsError(`A person unlocks, at a terminal — stdin here is not one.`, {
                exitCode: 5,
                nextStep: `If you are an agent: do not unlock things. Show the person what \`${BINARY_NAME} unlock\` ` +
                    `prints for "${key}" and let them decide.`,
            });
        }
        const c = CONSENTS[key];
        // ⚠ A wrong command line is refused BEFORE the question, so nobody answers y to nothing.
        const wallet = key === "wallet" ? parseWalletGrant(options, now(), VERSION) : null;
        say(c.what);
        say(`  ${c.risk}`);
        say(`  ${c.limit}`);
        if (currentMode() !== "skip-permissions") {
            const ask = options.readLine ?? promptLine;
            const answer = (await ask(`Unlock ${key} on this machine? [y/N] `)).trim();
            if (answer !== "y" && answer !== "Y") {
                say(`Nothing was unlocked.`);
                return 1;
            }
        }
        if (wallet !== null) {
            // ⛔ Not a bare date: scope, expiry and ceilings.
            writeWalletGrant(wallet);
            say(`unlocked: wallet — scope ${wallet.scope}, until ${wallet.expiresAt}`);
            say(`  ${ceilingWords(wallet.capWalFrost, wallet.capSuiMist)}`);
            return 0;
        }
        grant(key, VERSION, now());
        say(`unlocked: ${key}`);
        return 0;
    }
    if (action === "lock") {
        const key = keyOrFail(target);
        revoke(key);
        say(`locked: ${key}`);
        return 0;
    }
    throw new NmtsError(`Unknown: ${BINARY_NAME} unlock ${action}`, {
        exitCode: 2,
        nextStep: `Try \`${BINARY_NAME} unlock\`, \`${BINARY_NAME} unlock <name>\`, or \`${BINARY_NAME} lock <name>\`.`,
    });
}
function row(key, now) {
    if (key === "wallet") {
        const g = readWalletGrant();
        const state = walletGrantState(g, now);
        return {
            key,
            unlocked: state === "active",
            state,
            unlockedAt: g?.grantedAt ?? null,
            expiresAt: g?.expiresAt ?? null,
            scope: g?.scope ?? null,
            capWalFrost: g?.capWalFrost ?? null,
            capSuiMist: g?.capSuiMist ?? null,
            spentWalFrost: g?.spentWalFrost ?? null,
            spentSuiMist: g?.spentSuiMist ?? null,
            what: CONSENTS[key].what,
            risk: CONSENTS[key].risk,
        };
    }
    return { key, unlocked: grantedAt(key) !== null, unlockedAt: grantedAt(key), what: CONSENTS[key].what, risk: CONSENTS[key].risk };
}
/** The wallet row of the list: state, scope, expiry, ceilings and what was signed under it. */
function walletLines(now) {
    const g = readWalletGrant();
    const state = walletGrantState(g, now);
    const head = state === "active" ? "  unlocked  " : state === "expired" ? "  ran out   " : "  locked    ";
    const out = [`${head}  wallet`, `                ${CONSENTS.wallet.what}`];
    if (g !== null) {
        out.push(`                scope ${g.scope} · unlocked ${g.grantedAt} · ${state === "expired" ? "ran out" : "until"} ${g.expiresAt}`);
        out.push(`                ${ceilingWords(g.capWalFrost, g.capSuiMist)} · signed away so far ${coinAmount(BigInt(g.spentWalFrost))} WAL, ${coinAmount(BigInt(g.spentSuiMist))} SUI in fees`);
    }
    else {
        out.push(`                ${BINARY_NAME} unlock wallet --days <1..30> [--scope storage|all] [--cap-wal <coins> --cap-sui <coins>]`);
    }
    out.push(``);
    return out;
}
function ceilingWords(capWal, capSui) {
    if (capWal === null && capSui === null)
        return "no ceiling on what this tool may sign away";
    const parts = [];
    if (capWal !== null)
        parts.push(`${coinAmount(BigInt(capWal))} WAL`);
    if (capSui !== null)
        parts.push(`${coinAmount(BigInt(capSui))} SUI`);
    return `ceiling ${parts.join(" and ")}`;
}
