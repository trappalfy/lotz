import { programError } from "@lotz/sdk";

const FRIENDLY: Record<string, string> = {
  SlippageExceeded: "The price changed while you were signing. Check the new total and pay again.",
  OwnLot: "You already own some of these lots. Move or shrink the selection.",
  Paused: "Buying is paused right now.",
  TooManyPriorAds: "This spot takes lots from more than 16 ads. Make the rectangle smaller.",
  PriorAdMissing: "The board changed a moment ago. Try again.",
  WrongShards: "The board changed a moment ago. Try again.",
  WrongEpoch: "Your clock and the chain's disagree about the week. Try again.",
  InvalidLink: "Links must be https:// URLs without spaces, at most 200 characters.",
  InvalidTitle: "Titles are at most 64 characters, on one line.",
  InvalidImageUri: "The image upload went wrong. Upload it again.",
  RectOutOfBounds: "The rectangle is outside the board.",
  RectTooLarge: "Rectangles are at most 10 × 10 lots.",
  NothingToClaim: "There is nothing to claim on this ad.",
  AdNotEmpty: "This ad still has lots or an unclaimed refund.",
  NotAdOwner: "Only the ad's owner can do this.",
};

/** A plain sentence for anything that went wrong in a transaction. */
export function explainError(e: unknown): string {
  const text = String((e as { message?: string })?.message ?? e);
  if (/insufficient funds/i.test(text) && /Program Tokenkeg|Program TokenzQ/.test(text)) return "Not enough tokens in your wallet.";
  if (/user rejected|rejected the request|declined|cancel/i.test(text)) return "You cancelled in your wallet.";
  const custom = /custom program error: 0x([0-9a-f]+)/i.exec(text) ?? /"Custom":(\d+)/.exec(text);
  if (custom) {
    const code = custom[0].includes("0x") ? parseInt(custom[1]!, 16) : Number(custom[1]);
    const known = programError(code);
    if (known) return FRIENDLY[known.name] ?? known.msg;
    if (code === 1) return "Not enough tokens in your wallet.";
  }
  const named = /Error Code: (\w+)/.exec(text);
  if (named && FRIENDLY[named[1]!]) return FRIENDLY[named[1]!]!;
  if (/insufficient funds|insufficient lamports/i.test(text)) return "Not enough SOL for the fee and the ad account's rent.";
  if (/blockhash not found|block height exceeded/i.test(text)) return "The transaction expired before it landed. Try again.";
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}
