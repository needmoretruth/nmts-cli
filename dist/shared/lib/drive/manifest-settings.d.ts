export interface AccountSettings {
    /** Developer mode — technical storage facts + ciphertext links in the file detail. Absent = off. */
    developerMode?: true;
    /**
     * In-app text size, percent of the DEVICE's own size. Absent = 100 = follow the device. Never a
     * pixel value: the device's own accessibility setting stays underneath, and this multiplies it.
     */
    textScalePct?: number;
    /**
     * SIZE PADDING rule — how coarsely a file's stored size is rounded up.
     *
     * Absent = Padmé, the default: about 32 possible sizes per doubling, ~1% more storage.
     * `"pow2"` rounds to the next power of two: one size per doubling, ~39% more storage.
     * `"none"` does not round: the file's exact length is what the stored stream states, and about
     * 1% less storage is used. It was added on the owner's rule that anything Walrus itself allows
     * must be reachable here (2026-09-06); the cost of it is stated where the choice is made, which is
     * what makes it a choice rather than a trap.
     *
     * Here, in the sealed list, for the same reason the other two are: the server must not learn it
     * (it would be a per-account fingerprint the server could hold on to), and it
     * follows the account rather than the device, so a phone and a laptop pad the same way.
     *
     * ⚠ It applies to what is uploaded NEXT. Bytes already on the storage network cannot be
     * re-padded, and the screen says so.
     */
    paddingMode?: "pow2" | "none";
    /**
     * DEFAULT DEPOSIT — how many credits ride with each credit-paid upload as its deposit, in whole
     * credits. Absent = the full deposit (`DEPOSIT_MAX_CREDITS`), which is what a person who has
     * never touched this gets. `0` is a real answer and is written: it means "hold nothing back".
     *
     * The deposit pays the network fee when a file is released early; a file with no deposit pays
     * that fee twice, from the balance. The payment screen opens on this number and the person can
     * move it for that one upload.
     *
     * Here, in the sealed list, for the reason the padding rule beside it is: the server must not
     * learn it, and it follows the account, so the browser and the `nmts` command both open on the
     * same figure.
     */
    depositDefault?: number;
    /**
     * STANDING TIP — the share of every storage payment sent to the developer as a gift, in tenths
     * of a percent (25 = 2.5 %). Absent = 0 = nothing is sent. Set by the person, once, on the
     * wallet screen or with the CLI; from then on every payment sends it without a question, in
     * the coin just paid (WAL).
     */
    tipTenths?: number;
    /**
     * When the person first agreed to the gift terms (voluntary · nothing in return · not refundable
     * · goes to the published address · visible on the chain), as a UTC millisecond instant. Absent
     * = never agreed: raising the tip above 0 asks for that agreement once, and later changes do not.
     */
    tipConsentAt?: number;
    /**
     * WHICH WALLET PAYS — the index the NMTS key derives it at (NCF-3 §1.3, `walletSeed(N)`). Absent
     * = 0, the wallet every account has had since the beginning.
     *
     * ⛔ HERE, IN THE SEALED LIST, AND NOT BESIDE THE derived/imported SWITCH. That switch is about
     * this DEVICE (which key this browser opens), so it lives in device storage; the number is about
     * the ACCOUNT — it decides which address the storage is paid from, and a phone and a laptop that
     * disagreed about it would spend from two different balances for one person.
     *
     * Whole, 0 to just under 2^31: the format derives a wallet at every index and this is the range
     * an index is written in.
     */
    activeWallet?: number;
    /**
     * HOW MANY WALLETS THIS ACCOUNT HAS MADE — the list the wallets screen draws, 1 to 1000. Absent
     * = 1, the one wallet an account starts with.
     *
     * ⚠ IT IS A COUNT, NOT A SET. Numbers come from the key, so a wallet cannot be deleted and the
     * list is always 0…count-1; "making the next wallet" is this number going up by one, and a scan
     * that finds a funded wallet further out pulls it up to that number + 1.
     */
    walletCount?: number;
}
/** The sanity bounds a stored text scale must sit in to be USED. One place; codec and UI agree. */
export declare const TEXT_SCALE_MIN_PCT = 80;
export declare const TEXT_SCALE_MAX_PCT = 160;
/** Follow the device. Not written to the wire — absence is the only spelling of it. */
export declare const TEXT_SCALE_DEFAULT_PCT = 100;
/**
 * The index range a wallet number is written in: whole, 0 to just under 2^31.
 *
 * ⛔ THE CEILING IS THE WIRE'S, NOT THE FORMAT'S. `walletSeed(N)` is defined for every N the
 * engine can be handed; what is bounded here is what this build will WRITE and read back, so a
 * number some other build miswrote cannot come back as something no screen can draw.
 */
export declare const WALLET_INDEX_LIMIT: number;
/** The wallet an account pays from when nobody chose. Not written to the wire — absence spells it. */
export declare const ACTIVE_WALLET_DEFAULT = 0;
/** The most wallets one account's list holds. */
export declare const WALLET_COUNT_MAX = 1000;
/** What an account's list holds before anybody made a second one. Absence spells it. */
export declare const WALLET_COUNT_DEFAULT = 1;
/** Which wallet this account pays from. Absence is wallet 0, never "unknown". */
export declare function activeWalletOf(settings: AccountSettings | null | undefined): number;
/**
 * How many wallets this account's list holds.
 *
 * ⛔ THE INVARIANT LIVES HERE: the paying wallet is always IN the list. A stored count that does
 * not reach the active number is raised to hold it — never the other way round, because lowering
 * it would hide a wallet somebody is paying from, and a wallet cannot be deleted anyway.
 */
export declare function walletCountOf(settings: AccountSettings | null | undefined): number;
export interface WireSettings {
    /** developerMode. */
    dm?: 1;
    /** textScalePct. */
    tx?: number;
    /**
     * paddingMode, present only for the non-default rule.
     *
     * ⛔ ADDED 2026-08-24 AFTER MEASURING THAT IT WAS MISSING. The setting existed on
     * `AccountSettings`, the screen wrote it and the uploader read it — but neither direction of
     * this codec carried it, so every save dropped it and every reload went back to the default.
     * Somebody who chose to pay about 39% more storage to round their file sizes more coarsely got
     * the default rule instead, on every device, silently. A settings field is not saved because it
     * is declared; it is saved because both functions below name it.
     */
    pd?: "pow2" | "none";
    /**
     * depositDefault, present only when it is NOT the full deposit.
     *
     * ⚠ `0` is written and read here, unlike every optional field beside it: a person who wants no
     * deposit held has chosen something, and dropping a 0 would silently give them the full 64.
     */
    dd?: number;
    /** tipTenths, present only above 0. */
    tp?: number;
    /** tipConsentAt. */
    tc?: number;
    /** activeWallet, present only when it is not wallet 0. */
    aw?: number;
    /**
     * walletCount, present only when the account has made more than one.
     *
     * ⚠ A count above the ceiling is DROPPED on both sides, and nothing is lost by that: the read
     * below raises the count to hold `aw` again, so the paying wallet stays in the list either way.
     */
    wc?: number;
}
/** The most a standing tip can be: the whole payment. Above the dial's 10 % it is typed and confirmed. */
export declare const TIP_TENTHS_MAX = 1000;
/**
 * The deposit range this format carries: whole credits, 0 to 64.
 *
 * ⚠ The SERVER's own ceiling rides on the account view (`deposit_max`) and is what the payment
 * screen holds the chosen figure inside. This pair is the format's bound, so a value written by
 * some other build is read back only when it is one this build can also write.
 */
export declare const DEPOSIT_MAX_CREDITS = 64;
/** What an account's deposit is when nobody chose. Not written to the wire — absence spells it. */
export declare const DEPOSIT_DEFAULT_CREDITS = 64;
/** The default deposit in force for an account, in credits. Absence is the full deposit, not 0. */
export declare function depositDefaultOf(settings: AccountSettings | null | undefined): number;
/** Settings → wire, or null when every field is at its default (then nothing is written). */
export declare function settingsToWire(s: AccountSettings | undefined): WireSettings | null;
/**
 * Wire → settings, dropping anything unusable. A text scale outside the bounds is DROPPED, not
 * clamped: rendering a whole app at a number some other build miswrote is worse than falling back
 * to the device's own size, which is always readable.
 */
export declare function settingsFromWire(w: unknown): AccountSettings | undefined;
