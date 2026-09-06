export interface ServerRefusal {
    code: string;
    message: string;
    /**
     * Whatever the refusal carries beside its words — a limit that was hit, an address to go to.
     *
     * ⚠ Values are not all numbers: `AGENT_VERIFY_REQUIRED` names the page a person opens. Nothing
     *   here validates the shape, so a narrower type than the wire's would be a claim, not a check.
     */
    details?: Record<string, string | number>;
}
export declare function isRefusal(value: unknown): value is {
    error: ServerRefusal;
};
