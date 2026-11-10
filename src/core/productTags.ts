import { apiGet, type RequestOptions } from "./request";
import { assertNoApiErrors } from "./errors";
import { SHOPWAVE_LOOKUPS, type LookupKind } from "./resources";

/**
 * Turns a tag list from the API into clean strings: trims each tag, drops
 * blanks and anything that isn't text, and removes exact duplicates (first one
 * wins). The API's own order is kept. A map is accepted too (its values are
 * used), in case the API ever answers keyed by id.
 */
export function normalizeTagList(value: unknown): string[] {
  const list: unknown[] = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.values(value as Record<string, unknown>)
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== "string" && typeof item !== "number") continue;
    const tag = String(item).trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

async function fetchLookup(kind: LookupKind, options: RequestOptions): Promise<string[]> {
  const def = SHOPWAVE_LOOKUPS[kind];
  if (!def) throw new Error(`Unknown Shopwave lookup "${kind}"`);
  const json = await apiGet<Record<string, unknown> | null>(`/api/${def.route}`, {}, options);
  assertNoApiErrors(json, 200);
  // Shopwave answers an empty body when there's nothing to return.
  return normalizeTagList(json?.[def.key]);
}

/**
 * Every distinct tag used on the merchant's products (`GET /product/tags`),
 * for a tag field's suggestions. Returns `[]` when there are none.
 */
export function fetchProductTags(options: RequestOptions = {}): Promise<string[]> {
  return fetchLookup("productTags", options);
}

/**
 * Every distinct tag used on the merchant's price instances
 * (`GET /product/instance/tags`): the channel names (Eat In, Takeout, …).
 * Returns `[]` when there are none.
 */
export function fetchProductInstanceTags(options: RequestOptions = {}): Promise<string[]> {
  return fetchLookup("productInstanceTags", options);
}
