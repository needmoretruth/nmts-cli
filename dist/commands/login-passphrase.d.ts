/** What this needs of `login`'s options: the injected prompt, when a test supplies one. */
export interface PassphraseSource {
    /** Injected in tests. Called twice for a new passphrase — the second is the confirmation. */
    readPassphrase?: ((prompt: string) => Promise<string>) | undefined;
}
/**
 * A passphrase for a NEW seal: from the environment, or typed twice.
 *
 * ⚠ The environment form is not confirmed, because there is nothing to confirm it against and
 *   asking would hang. A typo there produces a file whose passphrase nobody knows — which is why
 *   the message below says to keep it, not merely to choose it.
 */
export declare function newPassphrase(options: PassphraseSource): Promise<string>;
