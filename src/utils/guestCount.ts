// "No of Guests": how many people one guest's pass admits (a family invited on one card). Every session of the event admits the same
// pass at most that many times. The web and mobile apps carry the same heading rule (utils/guestCount there).

export const MAX_GUESTS_PER_PASS = 100;
export const GUEST_COUNT_HEADER = 'No of Guests';

/**
 * Is this column heading the number of guests? "No of Guests", "No. of guests", "Number of Persons", "Guest Count", "Pax". A heading that
 * only says "Guest" or "Guests" is the name column (utils/columnMeaning.ts), so a count word is needed; "Guest No" is an ID, not a count.
 */
export function isGuestCountHeader(title: string | null | undefined): boolean {
  const t = String(title ?? '').toLowerCase().replace(/[^a-z]+/g, '');
  return /^(no|nos|num|number|count|total|qty|quantity)(of)?(guests?|persons?|people|members?|pax|attendees?)$/.test(t)
    || /^(guests?|persons?|people|members?|attendees?)count$/.test(t)
    || /^(pax|headcount|noofpax)$/.test(t);
}

/** The number written in a cell, or null when it is not a whole number from 1 to the maximum */
export function parseGuestCount(value: unknown): number | null {
  const text = String(value ?? '').trim();
  if (!/^\d{1,4}$/.test(text)) return null;
  const n = Number(text);
  return n >= 1 && n <= MAX_GUESTS_PER_PASS ? n : null;
}

/** How many people a stored guest's pass admits (guests saved before counts existed admit one) */
export const guestLimit = (invitee: { guestCount?: number | null } | null | undefined): number => {
  const n = Number(invitee?.guestCount);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, MAX_GUESTS_PER_PASS) : 1;
};
