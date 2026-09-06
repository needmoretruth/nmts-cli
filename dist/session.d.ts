import { type CredentialSource } from "./credentials.ts";
export interface Session {
    /** The NMTS key. ⛔ Held for the command's own work and never written anywhere. */
    code: string;
    /**
     * Where this machine got that code from.
     *
     * ⛔ CARRIED BECAUSE ONE THING A COMMAND DOES WITH THE CODE STILL NEEDS AN AGREEMENT. Sending
     *    the account proof (`account-proof.ts`) is that thing, and the agreement it asks for —
     *    `plain-env` — is about WHERE the code came from, not what is being done with it. A session
     *    that dropped this would leave the deciding module unable to tell a sealed stored code from
     *    an environment variable, and its only options would be to ask always or to ask never.
     */
    source: CredentialSource;
    apiKey: string;
    server: string;
    network: string;
    accountId: string;
}
/**
 * The API key, or the one refusal for not having one.
 *
 * ⛔ IT IS ITS OWN FUNCTION BECAUSE ONE COMMAND NEEDS THE KEY AND NOT THE CODE. `verify` asks the
 *    server about the account and opens no file, so making it resolve an NMTS key would refuse
 *    a run over a credential it never uses — and wording that refusal a second time is exactly how
 *    two texts for one problem start.
 */
export declare function requireApiKey(): string;
export declare function openSession(options: {
    server?: string | undefined;
    network?: string | undefined;
}): Promise<Session>;
