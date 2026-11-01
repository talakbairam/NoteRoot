/**
 * The address as `https://host[/path]` without a slash at the end, or undefined when it is not one: only `https` is accepted (a token
 * must never travel in the clear), with no query and no fragment. Pure, so the settings and the sign-in use the same rule.
 */
export function normalizeHttpsAddress(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && url.hostname !== "" && url.search === "" && url.hash === ""
      ? `${url.origin}${url.pathname.replace(/\/+$/, "")}`
      : undefined;
  } catch {
    return undefined;
  }
}
