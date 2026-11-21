/** Client-side copies of the program's content checks (programs/lotz/src/instructions/buy.rs). */
import { LINK_SCHEME, MAX_IMAGE_URI_LEN, MAX_LINK_LEN, MAX_TITLE_CHARS } from "./constants";

const printableAscii = (s: string) => /^[\x21-\x7e]*$/.test(s);
// eslint-disable-next-line no-control-regex
const hasControl = (s: string) => /[\u0000-\u001f\u007f-\u009f]/.test(s);

export function linkError(link: string): string | null {
  if (!link.startsWith(LINK_SCHEME)) return "Links must start with https://";
  if (link.length <= LINK_SCHEME.length) return "Add a domain after https://";
  if (new TextEncoder().encode(link).length > MAX_LINK_LEN) return `Links are at most ${MAX_LINK_LEN} characters`;
  if (!printableAscii(link)) return "No spaces or non-ASCII characters in links (use %-encoding)";
  try {
    const u = new URL(link);
    if (!u.hostname.includes(".")) return "That does not look like a domain";
  } catch {
    return "That is not a valid URL";
  }
  return null;
}

export function titleError(title: string): string | null {
  if ([...title].length > MAX_TITLE_CHARS) return `Titles are at most ${MAX_TITLE_CHARS} characters`;
  if (hasControl(title)) return "No line breaks or control characters";
  return null;
}

export function imageUriError(uri: string): string | null {
  if (uri.length === 0 || uri.length > MAX_IMAGE_URI_LEN || !printableAscii(uri)) return "Bad image URI";
  return null;
}
