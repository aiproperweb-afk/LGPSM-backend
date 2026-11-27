/** Test sheets predate the mandatory "No of Guests" column: it is added (one guest each) to a sheet that has a heading row and no such column */
import { isGuestCountHeader } from '../../src/utils/guestCount';

export function withGuests(rows: any[][]): any[][] {
  if (!rows.length || rows[0].some((c) => isGuestCountHeader(String(c)))) return rows;
  return rows.map((r, i) => {
    const padded = [...r, ...Array(Math.max(0, rows[0].length - r.length)).fill('')];
    // a blank row stays blank
    return [...padded, i === 0 ? 'No of Guests' : r.some((c) => String(c).trim() !== '') ? 1 : ''];
  });
}
