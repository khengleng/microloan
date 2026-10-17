/**
 * Linking a Telegram chat to a borrower.
 *
 * A phone number typed into the chat proves nothing, so a chat is linked only
 * from a contact the user shared with Telegram's "share my phone number"
 * button. Telegram attaches the sharer's own user id to that contact; a
 * contact whose `user_id` is not the sender's is someone else's card and is
 * refused.
 */

export interface SharedContact {
  phone_number: string;
  user_id?: number;
}

/** The verified phone number, or null when the contact is not the sender's own. */
export function verifiedOwnPhone(
  contact: SharedContact | undefined,
  senderId: number | undefined,
): string | null {
  if (!contact || senderId == null) return null;
  if (contact.user_id == null || contact.user_id !== senderId) return null;
  const digits = contact.phone_number.replace(/[^\d]/g, '');
  return digits.length >= 8 ? digits : null;
}

/**
 * The spellings a Cambodian number may have been stored under. Borrower phones
 * are indexed after stripping only spaces, dashes and brackets, so "+855…",
 * "855…" and the national "0…" form hash differently and all are tried.
 */
export function phoneCandidates(digits: string): string[] {
  const out = new Set<string>([digits, `+${digits}`]);
  if (digits.startsWith('855')) {
    const national = digits.slice(3);
    out.add(`0${national}`);
    out.add(national);
  } else if (digits.startsWith('0')) {
    out.add(`855${digits.slice(1)}`);
    out.add(`+855${digits.slice(1)}`);
  }
  return [...out];
}
