/**
 * Radix <Select.Item> crashes if value is an empty string.
 * Use safeSelectValue to guarantee a non-empty sentinel before rendering.
 */
export function safeSelectValue(value: string | null | undefined, fallback = "__unknown__"): string {
  if (!value || value.trim() === "") return fallback;
  return value;
}

/**
 * Returns true when a value is safe to use as a SelectItem value.
 * Use this to filter arrays before mapping to <SelectItem>.
 */
export function isValidSelectValue(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}
