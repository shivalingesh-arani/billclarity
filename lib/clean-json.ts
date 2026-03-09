/**
 * Strips markdown code fences and trims to the outermost JSON object braces.
 * Designed to clean raw Claude responses before passing to `jsonrepair` + `JSON.parse`.
 */
export function cleanJson(raw: string): string {
  let cleaned = raw.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "");
  const start = cleaned.indexOf("{");
  if (start > 0) cleaned = cleaned.slice(start);
  const end = cleaned.lastIndexOf("}");
  if (end !== -1 && end < cleaned.length - 1) cleaned = cleaned.slice(0, end + 1);
  return cleaned.trim();
}
