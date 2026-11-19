/**
 * Age from a birth date.
 *
 * Age is never stored — `candidates.birth_date` is, and this derives the number
 * on read, because a stored age is wrong from the day after it is written and
 * nothing would ever recompute it (the sync only refreshes the birth date).
 *
 * The birth date arrives as the ISO day string written by the personal-info
 * sync ("1990-12-06") and is compared as a CALENDAR DATE in the business
 * timezone, never as an instant: a birthday is a day where the person is, and
 * no part of it should depend on where the rendering process happens to run.
 */

import { toDayKey } from '@/lib/datetime';

export function candidateAge(
  birthDate: string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!birthDate) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(birthDate).trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  // "Today" is read in the business timezone, not the host's. These pages are
  // rendered by server components in a UTC container, where between 00:00 and
  // 07:00 WIB the host is still on yesterday's date — so anyone whose birthday
  // was that day appeared a year younger for the first seven hours of it.
  const today = toDayKey(now);
  if (!today) return null;
  const nowYear = Number(today.slice(0, 4));
  const nowMonth = Number(today.slice(5, 7));
  const nowDay = Number(today.slice(8, 10));

  let age = nowYear - year;
  // Not had this year's birthday yet → one year younger.
  const monthDiff = nowMonth - month;
  if (monthDiff < 0 || (monthDiff === 0 && nowDay < day)) age -= 1;

  // Out-of-range values are data problems, not ages: report nothing rather than
  // rendering "-3 th" or "137 th" next to somebody's name.
  if (age < 0 || age > 120) return null;
  return age;
}

/**
 * "1990-12-06" → "1990-12-06". Empty input renders as an em dash upstream.
 *
 * The input is already the app's display format, so this validates rather than
 * reformats — it used to emit "6 Des 1990", the one remaining place a date was
 * rendered in a shape nothing else on the page used. It deliberately does NOT
 * go through `lib/datetime`: a birth date is a calendar date with no instant
 * behind it, and turning it into a Date to format it back is what introduces
 * off-by-one-day errors near midnight.
 */
export function formatBirthDate(birthDate: string | null | undefined): string | null {
  if (!birthDate) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(birthDate).trim());
  if (!match) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}
