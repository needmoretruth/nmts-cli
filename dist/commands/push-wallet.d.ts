import type { OnCollision } from "../collision.ts";
import type { openSession } from "../session.ts";
import type { PaddingRule } from "../shared/lib/crypto/size-padding.ts";
import type { AccountSettings } from "../shared/lib/drive/manifest-settings.ts";
import { type PlannedFile, type PushOptions } from "./push.ts";
/** The wallet rail, one file at a time, stopping at the first failure as the credit rail does. */
export declare function pushWithWallet(session: Awaited<ReturnType<typeof openSession>>, options: PushOptions, run: {
    todo: PlannedFile[];
    already: PlannedFile[];
    found: number;
    bytes: number;
    partSize: number;
    rule: PaddingRule;
    asked: OnCollision | undefined;
    /** The sealed list's account settings, read once by `push.ts` — the standing tip lives in them. */
    settings: AccountSettings | undefined;
    folderIds: Map<string, string | null>;
    say: (line: string) => void;
}): Promise<number>;
