// Checking a tool call's arguments against the schema the tool advertised.
//
// ⛔ WHY THIS EXISTS: THE SCHEMA WAS DECORATION. Every tool declares an `inputSchema` and the
//    protocol hands it to the model, but nothing on this side ever compared a call against it. The
//    transport coerced anything that was not an object to `{}` and passed the rest straight
//    through, so `required`, the declared types and `additionalProperties: false` were all
//    advertised and none of them held. Each tool then hand-checked the one string it could not do
//    without, and checked booleans with `=== true` — which means a model sending `"dry_run": "true"`
//    (the string, which is what a model that has been told to send JSON text produces) got a real,
//    paid upload while believing it had asked for a price. That is the failure this file exists to
//    stop, and it is worth a file: the alternative is the same four checks written again inside
//    every tool, where the twentieth one will forget.
//
// ⛔ IT REFUSES; IT DOES NOT REPAIR. A wrong argument is answered with a message naming what was
//    wrong, never with a guess at what was meant. Coercing `"true"` to `true` would be deciding on
//    the caller's behalf that they wanted the branch that spends money, which is exactly the
//    decision that must not be made here. The model can read the refusal and call again.
//
// ⚠ IT UNDERSTANDS THE SUBSET THIS TOOL USES, AND SAYS SO WHEN IT DOES NOT. The schemas here are
//   flat objects of scalars and arrays of scalars. A keyword outside that subset is not silently
//   ignored: `unsupported()` lists what a schema asked for that this checker cannot judge, so a
//   schema that grows past it fails a test rather than quietly losing its guarantee.
import { isRecord } from "./guards.js";
/** The JSON types a declared property may have. */
const KNOWN_TYPES = ["string", "number", "integer", "boolean", "array", "object"];
/** Keywords this checker actually enforces. Anything else in a schema is reported, not ignored. */
const HANDLED_ROOT = ["type", "properties", "required", "additionalProperties", "description"];
const HANDLED_PROPERTY = ["type", "description", "items", "enum"];
function stringList(value) {
    return Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
}
/** What a value actually is, in the vocabulary the schema uses. */
function actualType(value) {
    if (Array.isArray(value))
        return "array";
    if (value === null)
        return "null";
    if (typeof value === "number")
        return Number.isInteger(value) ? "integer" : "number";
    return typeof value;
}
function typeMatches(declared, value) {
    switch (declared) {
        case "string":
            return typeof value === "string";
        case "boolean":
            return typeof value === "boolean";
        case "number":
            return typeof value === "number" && Number.isFinite(value);
        case "integer":
            return typeof value === "number" && Number.isInteger(value);
        case "array":
            return Array.isArray(value);
        case "object":
            return isRecord(value);
    }
}
function declaredType(property) {
    if (!isRecord(property))
        return null;
    const t = property["type"];
    return KNOWN_TYPES.find((k) => k === t) ?? null;
}
/**
 * Keywords a schema uses that this checker does not enforce.
 *
 * ⛔ THE POINT IS THAT IT IS NOT EMPTY-BY-ASSUMPTION. A checker that silently skips what it does
 *    not understand still returns "no problems", and a schema that grew a `minimum` or a `oneOf`
 *    would go on being advertised while nothing held it. A test compares this against the real
 *    tool table, so growing a schema past this file turns something red.
 */
export function unsupported(schema) {
    if (!isRecord(schema))
        return ["the schema is not an object"];
    const found = [];
    for (const key of Object.keys(schema)) {
        if (!HANDLED_ROOT.includes(key))
            found.push(key);
    }
    const properties = schema["properties"];
    if (isRecord(properties)) {
        for (const [name, property] of Object.entries(properties)) {
            if (!isRecord(property)) {
                found.push(`${name} (not an object)`);
                continue;
            }
            if (declaredType(property) === null)
                found.push(`${name}.type`);
            for (const key of Object.keys(property)) {
                if (!HANDLED_PROPERTY.includes(key))
                    found.push(`${name}.${key}`);
            }
        }
    }
    return found;
}
/**
 * Compare one call's arguments against the schema its tool advertised.
 *
 * Returns the problems, most important first: a missing required argument before a wrong type,
 * because a caller that forgot one is usually about to be told about the other for the same reason.
 * An empty array means the call may proceed.
 */
export function checkArgs(schema, args) {
    if (!isRecord(args)) {
        return [`arguments must be an object, and this call sent ${actualType(args)}`];
    }
    if (!isRecord(schema))
        return [];
    const properties = isRecord(schema["properties"]) ? schema["properties"] : {};
    const required = stringList(schema["required"]);
    const closed = schema["additionalProperties"] === false;
    const problems = [];
    for (const name of required) {
        if (!(name in args) || args[name] === undefined)
            problems.push(`\`${name}\` is required`);
    }
    for (const [name, value] of Object.entries(args)) {
        // ⚠ `undefined` cannot come off the wire — JSON has no such value — so a key holding it was
        //   built locally and means "not given". Treating it as given would refuse calls the caller
        //   made correctly.
        if (value === undefined)
            continue;
        const property = properties[name];
        if (property === undefined) {
            if (closed)
                problems.push(`\`${name}\` is not an argument this tool takes`);
            continue;
        }
        const type = declaredType(property);
        if (type === null)
            continue;
        if (!typeMatches(type, value)) {
            problems.push(`\`${name}\` must be ${type}, and this call sent ${actualType(value)}`);
            continue;
        }
        if (type === "array" && Array.isArray(value) && isRecord(property) && isRecord(property["items"])) {
            const itemType = declaredType(property["items"]);
            if (itemType !== null) {
                const wrong = value.findIndex((item) => !typeMatches(itemType, item));
                if (wrong !== -1) {
                    problems.push(`\`${name}\` must hold ${itemType} values, and item ${wrong + 1} is ${actualType(value[wrong])}`);
                }
            }
        }
        if (isRecord(property)) {
            const allowed = stringList(property["enum"]);
            if (allowed.length > 0 && typeof value === "string" && !allowed.includes(value)) {
                problems.push(`\`${name}\` must be one of ${allowed.join(", ")} — this call sent ${value}`);
            }
        }
    }
    return problems;
}
