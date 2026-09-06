export function isRefusal(value) {
    if (typeof value !== "object" || value === null || !("error" in value))
        return false;
    const error = Reflect.get(value, "error");
    if (typeof error !== "object" || error === null)
        return false;
    return typeof Reflect.get(error, "code") === "string" && typeof Reflect.get(error, "message") === "string";
}
