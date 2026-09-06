// `nmts consent` — see what this machine has agreed to, and change it.
//
// ⛔ IT IS A COMMAND AND NOT A PROMPT. A yes/no question in the middle of another command cannot
//    be answered by anything that is not a terminal, which is most of the places this tool runs:
//    a container, a build step, an agent's subprocess. Making agreement its own command means the
//    same answer works everywhere, is recorded with a date, and can be looked at afterwards —
//    none of which is true of a keystroke.
import { CONSENTS, CONSENT_KEYS, grant, grantedAt, revoke } from "../consent.js";
import { NmtsError } from "../errors.js";
import { BINARY_NAME, SUPPORT_EMAIL, VERSION } from "../product.js";
import { coinAmount } from "../wallet.js";
import { parseWalletGrant, readWalletGrant, walletGrantState, writeWalletGrant } from "../wallet-grant.js";
function isKey(value) {
    return CONSENT_KEYS.includes(value);
}
function keyOrFail(raw) {
    if (raw === undefined || raw === "") {
        throw new NmtsError("Say which one.", {
            exitCode: 2,
            nextStep: `One of: ${CONSENT_KEYS.join(" · ")}`,
        });
    }
    if (!isKey(raw)) {
        throw new NmtsError(`There is nothing called "${raw}" to agree to.`, {
            exitCode: 2,
            nextStep: `One of: ${CONSENT_KEYS.join(" · ")}`,
        });
    }
    return raw;
}
export function consent(action, target, options = {}) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    const now = options.now ?? (() => new Date());
    if (action === undefined || action === "" || action === "list") {
        if (options.json) {
            say(JSON.stringify(CONSENT_KEYS.map((key) => {
                if (key === "wallet") {
                    const g = readWalletGrant();
                    const state = walletGrantState(g, now());
                    return {
                        key,
                        granted: state === "active",
                        state,
                        grantedAt: g?.grantedAt ?? null,
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
                return {
                    key,
                    granted: grantedAt(key) !== null,
                    grantedAt: grantedAt(key),
                    what: CONSENTS[key].what,
                    risk: CONSENTS[key].risk,
                };
            })));
            return 0;
        }
        for (const key of CONSENT_KEYS) {
            if (key === "wallet") {
                for (const line of walletLines(now()))
                    say(line);
                continue;
            }
            const at = grantedAt(key);
            say(`${at === null ? "  not agreed" : "  agreed    "}  ${key}`);
            say(`                ${CONSENTS[key].what}`);
            if (at !== null)
                say(`                agreed on this machine ${at}`);
            say(``);
        }
        say(`  ${BINARY_NAME} consent grant <name>    agree, on this machine, once`);
        say(`  ${BINARY_NAME} consent revoke <name>   take it back`);
        say(``);
        say(`  Agreeing here does not change what the published Terms say. NMTS is not responsible`);
        say(`  for what any program on this machine does with this account, an AI agent included.`);
        say(`  Something wrong or confusing? ${SUPPORT_EMAIL}`);
        return 0;
    }
    if (action === "grant") {
        const key = keyOrFail(target);
        if (key === "wallet") {
            // ⛔ Not a bare date: scope, expiry and ceilings, parsed before anything is written.
            const wanted = parseWalletGrant(options, now(), VERSION);
            writeWalletGrant(wanted);
            say(`agreed: wallet — scope ${wanted.scope}, until ${wanted.expiresAt}`);
            say(`  ${CONSENTS.wallet.what}`);
            say(`  ${ceilingWords(wanted.capWalFrost, wanted.capSuiMist)}`);
            say(`  ${CONSENTS.wallet.limit}`);
            return 0;
        }
        grant(key, VERSION, now());
        say(`agreed: ${key}`);
        say(`  ${CONSENTS[key].what}`);
        say(`  ${CONSENTS[key].limit}`);
        return 0;
    }
    if (action === "revoke") {
        const key = keyOrFail(target);
        revoke(key);
        say(`taken back: ${key}`);
        return 0;
    }
    throw new NmtsError(`Unknown: ${BINARY_NAME} consent ${action}`, {
        exitCode: 2,
        nextStep: `Try \`${BINARY_NAME} consent\`, \`${BINARY_NAME} consent grant <name>\`, or \`${BINARY_NAME} consent revoke <name>\`.`,
    });
}
/** The wallet row of the list: state, scope, expiry, ceilings and what was signed under it. */
function walletLines(now) {
    const g = readWalletGrant();
    const state = walletGrantState(g, now);
    const head = state === "active" ? "  agreed    " : state === "expired" ? "  ran out   " : "  not agreed";
    const out = [`${head}  wallet`, `                ${CONSENTS.wallet.what}`];
    if (g !== null) {
        out.push(`                scope ${g.scope} · agreed ${g.grantedAt} · ${state === "expired" ? "ran out" : "until"} ${g.expiresAt}`);
        out.push(`                ${ceilingWords(g.capWalFrost, g.capSuiMist)} · signed away so far ${coinAmount(BigInt(g.spentWalFrost))} WAL, ${coinAmount(BigInt(g.spentSuiMist))} SUI in fees`);
    }
    else {
        out.push(`                ${BINARY_NAME} consent grant wallet --days <1..30> [--scope storage|all] [--cap-wal <coins> --cap-sui <coins>]`);
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
