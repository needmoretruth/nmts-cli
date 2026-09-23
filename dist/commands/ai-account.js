// `nmts ai-account list|create|delete` — the accounts a person makes for an AI to work in, from a
// terminal.
//
// ⛔ WHY THEY EXIST AT ALL. Handing an AI this account's NMTS key hands it everything: the files,
//    the wallet, the right to erase. An AI account is an ORDINARY account with its own key, its own
//    wallet and its own empty drive, made under this one — so what is handed over is an account
//    that holds nothing, and files reach it by being shared with it.
//
// ⛔ THE NMTS KEY PROVES IT, AND AN API KEY NEVER CAN. The three doors are closed to keys on
//    purpose (`domain::agent_routes`): an AI that could make AI accounts is an account factory, and
//    revoking its key would mean nothing once it had made three more. What travels is the derived
//    proof — the same value a sign-in sends (`account-proof.ts`) — never the key.
//
// ⛔ AND THERE IS NO MCP TOOL FOR ANY OF IT, for the reason `key new` has none: the credential that
//    mints credentials has to be the one a person holds.
//
// ⛔ THE NEW ACCOUNT'S KEY IS MADE HERE AND NEVER SENT. It is derived from this account's key and
//    the place (NCF-3 §1.5), so the same place always gives the same account back — a key that was
//    lost can be derived again, and an erased place can be re-used. What the server is told is the
//    same pair a sign-in sends, exactly as the browser tells it.
import { identityOf } from "../account.js";
import { accountProof, accountProofFor } from "../account-proof.js";
import { request, ServerError } from "../api.js";
import { requireAccountCode } from "../code-access.js";
import { readCredentialsFile } from "../credentials.js";
import { DERIVED, loadCrypto } from "../crypto.js";
import { CONFIRM_SENTENCE } from "./delete-account.js";
import { NmtsError } from "../errors.js";
import { isRecord } from "../guards.js";
import { BINARY_NAME, HOME_URL } from "../product.js";
import { promptLine } from "../prompt.js";
import { resolveServer } from "../server.js";
/** How many places an account has for AI accounts of its own. The server's own ceiling. */
const PLACES = 3;
function childrenOf(answer) {
    const list = isRecord(answer) ? answer["children"] : undefined;
    if (!Array.isArray(list)) {
        throw new NmtsError(`The server's answer did not carry a list of AI accounts.`, {
            nextStep: `Nothing was changed. Report it rather than retrying — the shape, not the network, is wrong.`,
        });
    }
    const out = [];
    for (const row of list) {
        if (!isRecord(row))
            continue;
        const id = row["account_id"];
        const index = row["child_index"];
        const created = row["created_at"];
        const status = row["status"];
        if (typeof id !== "string" || typeof index !== "number" || typeof created !== "string")
            continue;
        const code = row["public_code"];
        out.push({
            account_id: id,
            child_index: index,
            public_code: typeof code === "string" ? code : null,
            created_at: created,
            status: typeof status === "string" ? status : "active",
        });
    }
    return out;
}
async function caller(options) {
    const held = await requireAccountCode();
    const stored = readCredentialsFile();
    const server = resolveServer(options.server ?? stored?.server);
    const identity = await identityOf(held.code);
    // ⛔ BUILT FOR THIS ONE RUN AND KEPT BY NOBODY, and it asks for the agreement that covers sending
    //    it when the key came from an environment variable.
    const authSecret = await accountProofFor({ code: held.code, source: held.source });
    return { server, accountId: identity.accountId, authSecret, code: held.code };
}
async function listFor(who) {
    return childrenOf(await request(who.server, "/v1/account/ai-accounts/list-by-code", {
        method: "POST",
        body: { account_id: who.accountId, auth_secret: who.authSecret },
    }));
}
/**
 * `nmts ai-account <verb>`.
 *
 * ⛔ THE BARE WORD LISTS, AND THAT IS THE SAFE HALF ON PURPOSE. A command whose bare form created
 *    something would make `ai-account` a thing somebody runs to find out what it does.
 */
export async function aiAccount(verb, args) {
    const options = { server: args.server, json: args.json, yes: args.yes };
    if (verb === undefined || verb === "" || verb === "list")
        return await list(options);
    if (verb === "create")
        return await create(args.operands[1], options);
    if (verb === "delete")
        return await remove(args.operands[1], options);
    throw new NmtsError(`\`${verb}\` is not an ai-account verb.`, {
        exitCode: 2,
        nextStep: `The verbs are \`${BINARY_NAME} ai-account list\`, \`${BINARY_NAME} ai-account create [place]\` ` +
            `and \`${BINARY_NAME} ai-account delete <account id>\`. Each needs the NMTS key on this ` +
            `machine; an API key cannot reach any of them.`,
    });
}
export async function list(options = {}) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    const who = await caller(options);
    const children = await listFor(who);
    if (options.json === true) {
        say(JSON.stringify({ children }));
        return 0;
    }
    if (children.length === 0) {
        say(`This account has made no AI accounts.`);
        say(`\`${BINARY_NAME} ai-account create\` makes one — an ordinary account with its own key and`);
        say(`its own empty drive, so nothing of this one's is handed over.`);
        return 0;
    }
    for (const child of children) {
        say(`place ${child.child_index}  ${child.account_id}  ${child.status}  made ${child.created_at.slice(0, 10)}`);
    }
    say(``);
    say(`Each one's NMTS key comes from this account's key and its place, so it can be derived again`);
    say(`— \`${BINARY_NAME} ai-account create <place>\` on a place that is already taken says so rather`);
    say(`than printing it. \`${BINARY_NAME} ai-account delete <account id>\` erases one for good.`);
    return 0;
}
/** The place this run uses: the one asked for, or the lowest that is free. */
function placeFor(asked, taken) {
    if (asked !== undefined && asked !== "") {
        if (!/^[0-9]+$/u.test(asked.trim())) {
            throw new NmtsError(`A place is a whole number from 1 to ${PLACES}, not "${asked}".`, { exitCode: 2 });
        }
        const place = Number(asked.trim());
        if (place < 1 || place > PLACES) {
            throw new NmtsError(`This account has ${PLACES} places for AI accounts, numbered 1 to ${PLACES}.`, {
                exitCode: 2,
                nextStep: `Nothing was made. \`${BINARY_NAME} ai-account list\` says which are taken.`,
            });
        }
        return place;
    }
    const used = new Set(taken.map((child) => child.child_index));
    for (let place = 1; place <= PLACES; place += 1)
        if (!used.has(place))
            return place;
    throw new NmtsError(`All ${PLACES} places under this account are taken.`, {
        exitCode: 4,
        nextStep: `Nothing was made. Erase one with \`${BINARY_NAME} ai-account delete <account id>\` — its place ` +
            `comes free and re-deriving at that place later gives the same account back.`,
    });
}
/**
 * Make one.
 *
 * ⛔ THE KEY IS PRINTED ONCE AND IS NOT STORED ANYWHERE. It is what the AI is given; this machine
 *    goes on being the account it already was. It can be derived again from this account's key and
 *    the place, which is the one thing that makes printing it here safe to have missed.
 */
export async function create(asked, options = {}) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    const who = await caller(options);
    const place = placeFor(asked, await listFor(who));
    // ⛔ DERIVED HERE AND SENT NOWHERE. What the server is told is the pair below, which is what a
    //    sign-in sends for any account; the key itself never leaves this process.
    const glue = await loadCrypto();
    const derived = glue.kdf_derive(glue.account_code_parse(who.code));
    const [from, to] = DERIVED.aiAccountRoot;
    let childCode;
    try {
        childCode = glue.derive_ai_account_code(derived.subarray(from, to), place);
    }
    finally {
        derived.fill(0);
    }
    const childIdentity = await identityOf(childCode);
    const childSecret = await accountProof(childCode);
    try {
        await request(who.server, "/v1/account/ai-accounts/by-code", {
            method: "POST",
            body: {
                account_id: who.accountId,
                auth_secret: who.authSecret,
                child_account_id: childIdentity.accountId,
                child_auth_secret: childSecret,
                child_index: place,
            },
            // ⛔ NOT REPEATED ON A TIMEOUT. A request that reached the server and died on the way back has
            //    already spent a place and one of the day's creations; a retry would spend another.
            retryBudgetMs: 0,
        });
    }
    catch (error) {
        if (error instanceof ServerError && error.code === "AI_ACCOUNTS_NEED_ENABLE") {
            throw new NmtsError(`The first AI account under this account is made in a browser.`, {
                exitCode: 4,
                nextStep: `Nothing was made. Turning the feature on costs a human check, which no command-line tool ` +
                    `can pass — do it once on the account screen at ${HOME_URL}, and every one after it can be ` +
                    `made from here.`,
            });
        }
        throw error;
    }
    if (options.json === true) {
        // ⛔ THE KEY IS IN THE JSON, because there is nowhere else it could go and a caller that asked
        //    for a machine-readable answer is the caller that has to hand it to something.
        say(JSON.stringify({ account_id: childIdentity.accountId, child_index: place, account_code: childCode }));
        return 0;
    }
    say(`A new account for an AI exists, at place ${place}.`);
    say(``);
    say(`  account id  ${childIdentity.accountId}`);
    say(``);
    say(`⛔ THIS IS ITS NMTS KEY. It opens that account and nothing else — not this one.`);
    say(`   Hand it to the program that will use it, and keep it as carefully as your own.`);
    say(``);
    say(`   ${childCode}`);
    say(``);
    say(`Nothing on this machine changed. The account is empty: it has its own wallet and no credits,`);
    say(`and files reach it by being shared with it (\`${BINARY_NAME} share\`).`);
    return 0;
}
/**
 * Erase one.
 *
 * ⛔ IT IS THE SAME ERASURE THE ACCOUNT ITSELF WOULD RUN — the row, the files, the keys, the shares
 *    in both directions — and nothing undoes it. The typed sentence is `delete-account`'s, because
 *    it is the same act aimed at a different account.
 */
export async function remove(id, options = {}) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    if (id === undefined || id === "") {
        throw new NmtsError(`Say which AI account to erase.`, {
            exitCode: 2,
            nextStep: `\`${BINARY_NAME} ai-account delete <account id>\` — the id \`${BINARY_NAME} ai-account list\` prints.`,
        });
    }
    const who = await caller(options);
    say(`⛔ This erases AI account ${id} and everything in it. Nothing brings it back.`);
    say(`   Its place comes free: re-deriving at that place later gives the same account, empty.`);
    const ask = options.readLine ?? promptLine;
    const typed = options.yes === true ? CONFIRM_SENTENCE : (await ask(`Type exactly: ${CONFIRM_SENTENCE}\n> `)).trim();
    if (typed !== CONFIRM_SENTENCE) {
        say(`Nothing was erased.`);
        return 1;
    }
    try {
        await request(who.server, "/v1/account/ai-accounts/erase-by-code", {
            method: "POST",
            body: { account_id: who.accountId, auth_secret: who.authSecret, child_id: id },
            retryBudgetMs: 0,
        });
    }
    catch (error) {
        if (error instanceof ServerError && error.status === 404) {
            throw new NmtsError(`This account made no AI account with the id ${id}.`, {
                exitCode: 4,
                nextStep: `Nothing was erased. \`${BINARY_NAME} ai-account list\` says which ones exist.`,
            });
        }
        throw error;
    }
    say(`Erased. The server holds nothing about that account now.`);
    return 0;
}
