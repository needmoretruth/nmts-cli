export interface EnvOptions {
    json?: boolean;
    write?: (line: string) => void;
}
export declare function env(options?: EnvOptions): number;
