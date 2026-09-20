import type { NmtsError } from "../errors.ts";
export interface StorageHints {
    /**
     * The `nextStep` for a chain that did not answer. The chain's own cause is added after it, so
     * this is the part before `Cause: …` and nothing else.
     */
    cannotRead?: string | undefined;
    /** The `nextStep` for a resource this wallet does not hold free. */
    notHeld?: string | undefined;
    /**
     * The whole refusal for a cut that would keep nothing or everything.
     *
     * ⚠ A FUNCTION BECAUSE THE NUMBER IS THE CHAIN'S: `limit` is the resource's own size, already in
     *   the units a person reads, or its own number of epochs. What the refusal calls the thing that
     *   was too big — a flag, a field — is the caller's to say.
     */
    cut?: ((what: "size" | "period", limit: string) => NmtsError) | undefined;
    /** The `nextStep` for a storage term that has already ended. */
    lapsed?: string | undefined;
}
