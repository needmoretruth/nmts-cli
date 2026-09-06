import type { AccountSettings, ManifestEntry } from "./manifest-codec.ts";
/** One drive edit, in a form that can be replayed onto a newer list. */
export type ManifestIntent = 
/** Insert or replace by id. Upload-commit and folder-create both land here. */
{
    op: "add";
    entry: ManifestEntry;
}
/** New plaintext name for one item. */
 | {
    op: "rename";
    id: string;
    name: string;
    at: number;
}
/** New parent (null = drive root). */
 | {
    op: "move";
    id: string;
    parentId: string | null;
    at: number;
}
/** Send to the trash. Already-trashed ids keep their original instant. */
 | {
    op: "trash";
    ids: readonly string[];
    at: number;
}
/** Bring back out of the trash. */
 | {
    op: "restore";
    ids: readonly string[];
    at: number;
}
/** Remove from the list entirely — the storage record is gone or going. */
 | {
    op: "purge";
    ids: readonly string[];
}
/** Star / unstar. `on` is the DESIRED state, never a toggle: a replayed toggle would flip twice. */
 | {
    op: "favorite";
    ids: readonly string[];
    on: boolean;
    at: number;
}
/** Pin / unpin to the top of the item's own folder. Same desired-state rule as favourite. */
 | {
    op: "pin";
    ids: readonly string[];
    on: boolean;
    at: number;
}
/** Put one label on (or take it off) these items. */
 | {
    op: "label";
    ids: readonly string[];
    label: string;
    on: boolean;
    at: number;
}
/** Rename a label everywhere it appears. Items already wearing `to` do not gain a duplicate. */
 | {
    op: "labelRename";
    from: string;
    to: string;
    at: number;
}
/** Remove a label from every item — which is what makes it stop existing. */
 | {
    op: "labelDelete";
    label: string;
    at: number;
}
/**
 * Write MY OWN receipt that this file was shared with this address.
 *
 * Upsert by address, because the server replaces rather than stacks a re-share to the same
 * person (`shares_one_per_recipient`); a second receipt would show one recipient twice.
 */
 | {
    op: "shareRecord";
    id: string;
    address: string;
    at: number;
}
/** Mark a receipt as revoked — a revocation was sent. No-op when there is no receipt for that address. */
 | {
    op: "shareRevoked";
    id: string;
    address: string;
    at: number;
}
/**
 * Drop receipts the server's listing has confirmed gone.
 *
 * ⛔ ONLY REVOKED RECEIPTS ARE DROPPED. An active receipt whose row is missing is the entire
 * point of keeping receipts — pruning it would erase the warning instead of showing it — and
 * the restriction is also what makes this intent safe to replay onto a list where the address
 * was just re-shared.
 */
 | {
    op: "sharePrune";
    id: string;
    addresses: readonly string[];
    at: number;
};
/**
 * Apply one intent, returning a new list. The input is never mutated: the store keeps the
 * pre-save snapshot around to rebuild from after a version conflict.
 *
 * Returns the SAME array reference when nothing changed, so callers can skip a re-render and a
 * save for an intent that turned out to be a no-op (a rename to the name it already had, a trash
 * of something another device already purged).
 */
export declare function applyIntent(entries: readonly ManifestEntry[], intent: ManifestIntent): readonly ManifestEntry[];
/**
 * Which size-padding rule an account seals its next upload under.
 *
 * ⛔ DECLARED BESIDE THE PATCH THAT CARRIES IT, not in `lib/crypto/padding.ts` where the padding
 *    itself lives. `padding.ts` imports it from here. The direction matters: this file is copied
 *    byte-for-byte into the `nmts` command-line package, and a type reaching out of it into the
 *    crypto tree would drag that whole tree along with it for the sake of two string literals.
 */
export type PaddingMode = "padme" | "pow2" | "none";
/**
 * One account-settings edit, as DESIRED STATE per field — never "toggle", so replaying it onto a
 * list another device wrote lands the same answer. A default value means absence in the codec.
 */
export interface SettingsPatch {
    developerMode?: boolean;
    textScalePct?: number;
    /** Which rule seals future uploads: `"padme"` = the default, `"none"` = the file's exact length. */
    paddingMode?: PaddingMode;
    /** Credits held back with each credit-paid upload, 0 to `DEPOSIT_MAX_CREDITS`. */
    depositDefault?: number;
    /** The standing tip in tenths of a percent (0 = none) and the instant its terms were agreed to (0 clears). */
    tipTenths?: number;
    tipConsentAt?: number;
}
/**
 * Apply one settings patch, returning new settings. Returns the SAME reference when nothing
 * changed, so callers can skip a save (a version bump every other device must download).
 *
 * A text scale is CLAMPED into the codec's bounds here — this is the one write path, so a value
 * the slider or the typed field lets through never reaches the wire out of range.
 */
export declare function applySettingsPatch(settings: AccountSettings, patch: SettingsPatch): AccountSettings;
/** Replay a whole queue in order. Used to rebuild after a version conflict. */
export declare function applyIntents(entries: readonly ManifestEntry[], intents: readonly ManifestIntent[]): readonly ManifestEntry[];
/**
 * True when the intent touches storage the server also tracks, so a save must not be deferred.
 *
 * A queued save that dies with the tab is recoverable for a rename (the name is only in the
 * manifest, and losing it leaves the old name — annoying, not damaging). It is NOT recoverable
 * when a file was just committed or just deleted: the storage record moved, and a manifest that
 * disagrees leaves a file that is paid for but invisible, or one that shows but is gone.
 *
 * Stars, pins and labels are deliberately NOT in this list: they exist only in the manifest, so the
 * worst a lost save can do is leave a file unstarred — the same recoverable loss as a rename.
 *
 * SHARE RECEIPTS ARE, for the same reason a commit is: they describe a row the server now
 * holds, and nothing else on this side records it. A receipt lost with the tab does not degrade to
 * a wrong colour — it degrades to a share this device can never again hold the server to.
 * `sharePrune` stays out: losing it leaves a settled receipt that the next listing prunes again.
 */
export declare function mustSaveNow(intent: ManifestIntent): boolean;
