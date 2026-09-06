// What a caller does next about a refusal the server explained.
//
// ⛔ IT LIVES BESIDE `api.ts` RATHER THAN INSIDE IT. This is one table with one job — a code in, a
//    sentence out — and it had grown to be most of the file it sat in, which is why the request
//    path there had no room left to learn anything new. Splitting on this line leaves each file
//    readable as one thing.
//
// ⛔ `check:advice` READS THIS FILE'S SWITCH and compares it, as a set, against every code
//    `api/src/error.rs` can send. A code in neither this table nor that gate's SILENT list is not
//    a decision, it is an oversight — so moving this table means moving what the gate reads, and
//    both moved together.
//
// ⛔ EACH SENTENCE NAMES ONE NEXT STEP, OR SAYS THERE IS NONE. "Unauthorized" tells an agent
//    nothing it can act on; "this key was revoked — make a new one" tells it whether to retry, to
//    ask a person, or to stop. Several entries exist only to stop an agent from retrying the one
//    remedy that cannot possibly work.
/** What a caller does next about a refusal, when the tool knows something the message does not. */
export function adviseFor(code) {
    switch (code) {
        case "CLEARANCE_REQUIRED":
        case "TURNSTILE_FAILED":
            return ("This account needs a human check, which a command-line tool cannot pass. An API key " +
                "made on the account screen is what waives it — put it in NMTS_API_KEY. If that screen " +
                "has no place to make one, this server does not have API keys switched on.");
        case "UNAUTHORIZED":
            return "The credential is missing or expired. Check NMTS_API_KEY, or make a new key.";
        // ⛔ Each of these says something different on purpose, because the remedies are different
        //    and a program that cannot tell them apart will retry the one thing that cannot work.
        case "SESSION_REVOKED":
            return "That is a browser session somebody ended from another device, not an API key. A key is what a program should carry; NMTS_API_KEY is where it goes.";
        case "API_KEY_REVOKED":
            return "Somebody revoked this key. It will not start working again — make a new one.";
        case "API_KEY_EXPIRED":
            return "This key reached the end of the lifetime it was given. Make a new one.";
        case "API_KEY_SCOPE":
            return ("The key is valid and was not given permission for this. Nothing here will succeed with " +
                "it — a key with the right permissions has to be made on the account screen.");
        case "API_KEY_MALFORMED":
            return ("What was sent is not a well-formed key. Check that the whole string was copied, with " +
                "no quotes or line break — it is one line of exactly 65 characters.");
        case "ACCOUNT_CODE_NOT_A_CREDENTIAL":
            return ("That was an account code, not an API key. The code never goes to the server; it stays " +
                "on this machine and opens the files. Put the code in NMTS_ACCOUNT_CODE and the key in " +
                "NMTS_API_KEY.");
        case "AGENT_VERIFY_REQUIRED":
            return ("This was refused because nothing has checked lately that a person is behind this " +
                "account's key. Ask the person to run `nmts verify` and to follow what it prints — it " +
                "gives them a code to type at a browser, and nothing here can pass that check for them.");
        case "SUPPORT_DUPLICATE":
            return ("The same message reached the developer within the last day, so this one was not filed " +
                "twice — nothing was lost. Sending it again will be refused again: say something the " +
                "first message did not, or read the reply on the thread that is already open.");
        // ⛔ THE REFUSAL IS CORRECT AND THERE IS NOTHING HERE TO WORK AROUND. Accepting terms is a
        //    person reading a document and agreeing to it; a program doing it for them would be
        //    signing on somebody else's behalf, and this tool holds an API key, not a person. So the
        //    only thing missing was the advice — without it an agent gets a bare 403 and starts
        //    trying credentials, which is the one thing that cannot be the cause.
        // ⭐ 2026-09-06: the person no longer needs a browser for it. `nmts accept-terms`
        //    is refused in mode auto and asks them to type the version, so the advice names it — an
        //    agent still cannot run it, and the sentence says so.
        //
        // ⚠ It does not say WHICH requests are refused. The server gates some and not others (reading
        //   and deleting are not gated today), that line has moved twice, and a sentence here naming
        //   the list would be a copy of it that nothing keeps true.
        case "TERMS_ACCEPTANCE_REQUIRED":
            return ("This account has not accepted the terms now in force, and the server refuses this " +
                "request until it does. Nothing an agent runs can accept them. Ask the person to run " +
                "`nmts accept-terms` themselves (it is refused in mode auto), or to accept on the " +
                "account screen at nmts.me. Other requests may still work in the meantime.");
        // ⛔ A KEY IS NOT ENOUGH HERE AND NEVER WILL BE. These routes rebuild what makes the account
        //    recoverable without NMTS, and the owner's rule is that the code is re-entered for them.
        //    An agent that reads this as "my key is wrong" starts making new keys, which is the one
        //    remedy that cannot work.
        case "ACCOUNT_PROOF_REQUIRED":
            return ("This request needs proof of the account code as well as the key, and what was sent was " +
                "missing or did not match. Check that the code this machine is holding belongs to the " +
                "same account as the key. Wrong attempts are counted, and three of them lock these " +
                "routes for a while.");
        case "ACCOUNT_BANNED":
            return "This account is suspended. Nothing here will succeed until that is lifted.";
        // ── Getting to the starting line ──────────────────────────────────────────────────────────
        case "ACCOUNT_EXISTS":
            return "An account already exists for that. Use the one you have rather than making another.";
        case "ALPHA_NOT_OPEN":
            return ("This build asks the server for a channel it does not open. This is not something to " +
                "retry or to fix with a different credential — use a release build.");
        case "API_KEY_CAP":
            return ("The account holds as many live keys as it is allowed. Nothing here can raise the limit: " +
                "the person has to revoke a key they no longer use, on the account screen at nmts.me.");
        case "API_KEY_CHANNEL":
            return ("This account is enrolled on a preview build, and keys are not issued while it is. Ask " +
                "the person to leave the preview on the account screen, then make the key.");
        case "INVALID_CREDENTIALS":
            return ("The server did not accept what was sent. For a key: check the key. For `key new`: the " +
                "server checked the proof derived from the account code, and it did not match a registered " +
                "account — the code itself never goes to the server.");
        case "LOCKED_OUT":
            return ("Too many failed attempts, so this is shut for a while. Retrying now makes it longer, " +
                "not shorter. The refusal carries the moment it lifts; wait for it.");
        case "RATE_LIMITED":
            return ("Too many requests too quickly. Wait and send fewer — the refusal carries how long. This " +
                "is not a credential problem, so changing keys will not help.");
        case "SURFACE_MISMATCH":
            return ("This account acts through a different build than the one calling. The refusal names " +
                "which; nothing on this machine can change it, and the person switches it at nmts.me.");
        // ── The terms ─────────────────────────────────────────────────────────────────────────────
        case "TERMS_VERSION_MISMATCH":
            return ("The versions sent are not the ones in force; the refusal carries the ones that are. " +
                "This is a stale copy, not a refusal to serve — read the current versions and send those.");
        case "TERMS_NOT_IN_FORCE":
            return ("There is nothing to accept, so accepting cannot be what is missing. This is a server " +
                "condition; report it rather than retrying.");
        // ── Credits and the free trial ────────────────────────────────────────────────────────────
        case "CREDIT_FILE_CAP":
            return ("One file may cost at most the published cap in credits, and this one costs more. The " +
                "refusal carries both numbers. Splitting the file is the way through; more credits is not.");
        case "CREDIT_DAILY_CAP":
            return ("The account has spent its allowance for today. The refusal carries the cap and what is " +
                "spent. Waiting for the day to turn is the only remedy — buying credits does not lift it.");
        case "TRIAL_CLOSED":
            return "The free trial is not open at all right now. Credits have to come from a funded wallet.";
        case "TRIAL_FULL":
            return "This week's free-trial places are taken. Applying again this week cannot succeed; next week can.";
        case "TRIAL_ALREADY":
            return "This account already took the free trial this week. It comes round weekly, not once.";
        case "TRIAL_HELD":
            return "Free-trial applications are paused pending review. Retrying does not move it.";
        case "TRIAL_LINE_CAPPED":
            return ("This internet connection has taken its share of this week's places today — the limit is " +
                "on the connection, not on the account, so another account here hits it too.");
        // ── Storage, the chain, and what is safe to retry ─────────────────────────────────────────
        // ⛔ THE THREE OUTCOMES ARE DIFFERENT AND AN AGENT MUST NOT COLLAPSE THEM. Refused means it did
        //    not happen. Failed means it did not finish. Uncertain means nobody knows — and that is the
        //    one where retrying blindly can spend money twice.
        case "CHAIN_REQUEST_REFUSED":
            return ("The storage service refused the request itself, so nothing was spent and nothing was " +
                "stored. Retrying the same request will be refused the same way.");
        case "CHAIN_REGISTER_FAILED":
            return "Registering the storage did not go through. Nothing is stored; the upload can be tried again.";
        case "CHAIN_CERTIFY_FAILED":
            return ("The bytes went out but the storage was never certified, so the file is not safely stored. " +
                "Try the upload again.");
        case "CHAIN_UNCERTAIN":
            return ("⛔ Nobody knows whether the storage was registered. Do NOT simply retry: doing so can pay " +
                "twice for the same file. Run `nmts ls` first and see whether the file is there.");
        case "CHAIN_SPEND_CAP":
            return ("The service has stopped spending on storage for today. This is not about this account " +
                "and no credential or credit changes it. Try tomorrow.");
        case "CHAIN_DELETE_FAILED":
            return ("The storage could not be released. The file's record is gone from this side either way, " +
                "so nothing here is stuck — the storage runs out on its own when its time is up.");
        case "RELEASE_NOT_SPONSORED":
            return ("This file's storage was not paid for with credits, so it is not the server's to release. " +
                "Storage bought from a wallet is released by that wallet.");
        case "SPONSORED_STATE":
            return ("The upload is not at the step that call belongs to — the steps have an order and one was " +
                "skipped or already done. Start the upload again rather than repeating this call.");
        // ── Two callers, one drive ────────────────────────────────────────────────────────────────
        case "MANIFEST_TOO_LARGE":
            return ("The sealed file list is over the server's ceiling (16 MiB, roughly 60,000 files), so this " +
                "save was refused and nothing changed. Delete files to shrink the list, or ask the operator " +
                "for a higher ceiling from the inbox (nmts support send) with a sentence on why.");
        // ── The chunked file list (NCF-3 §6.3) ────────────────────────────────────────────────────
        case "MANIFEST_CHUNK_HASH":
            return ("The name in the path is not the SHA-256 of the `ct` string being sent, so the server " +
                "refused to store it under that name. Hash the base64url text exactly as it travels, not " +
                "the bytes it decodes to, and send it under that name.");
        case "MANIFEST_CHUNK_TOO_LARGE":
            return ("One chunk of the file list is over the server's 4 MiB ceiling of sealed bytes. Pack " +
                "fewer entries per chunk — the format's own bound is on the plaintext, so a chunk built " +
                "to it is always under this — and send the same index again.");
        case "MANIFEST_CHUNK_MISSING":
            return ("The index names chunks this account has not stored. The refusal lists them in " +
                "details.missing: write exactly those chunks, then send the same index again. Nothing " +
                "changed and the version did not move.");
        case "MANIFEST_CHUNKS_EXCEEDED":
            return ("The account is at its chunk allowance (details.allowed). It is a base allowance plus " +
                "one chunk for every details.per_verified_items files the storage network has confirmed, " +
                "so it grows as files are stored; deleting files or packing the list into fewer chunks is " +
                "what brings this write inside it.");
        case "VERSION_CONFLICT":
            return ("Something else changed the drive since this was read. Nothing is lost and nothing is " +
                "wrong with the credential: read the current state and apply the change to that.");
        case "ERASE_BLOCKED":
            return ("The account cannot be erased while retained records still point at it. This will not " +
                "clear by retrying; the records have their own retention and it has to run out.");
        case "CREDITS_SHORT":
            return "The account does not have enough credits for this upload.";
        default:
            return null;
    }
}
