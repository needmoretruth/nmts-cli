export interface OnCollisionOptions {
    json?: boolean;
    write?: (line: string) => void;
    now?: () => Date;
}
export declare function onCollision(wanted: string | undefined, options?: OnCollisionOptions): number;
