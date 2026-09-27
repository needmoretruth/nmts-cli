import { type Session } from "../session.ts";
import { type AccountSettings } from "../shared/lib/drive/manifest-settings.ts";
import { type HeavyPayer } from "./heavy-run.ts";
import { type PutOptions } from "./put.ts";
/** Who would pay, by address, for a dry run — derived offline, nothing signed. */
export declare function payerAddressOf(session: Session, payer: HeavyPayer, options: PutOptions, settings: AccountSettings | undefined): Promise<Record<string, unknown>>;
/** The dry run's words for a person: one plan line per payer, and the closing line. */
export declare function sayDryRun(say: (line: string) => void, name: string, facts: Record<string, unknown>): void;
export declare function putHeavy(target: string | undefined, options: PutOptions): Promise<number>;
