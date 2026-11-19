import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Date/time formatting lives in `lib/datetime.ts`. It used to live here as four
// functions — formatDate, formatDateTime, formatTimestamp, formatNaiveTimestamp
// — of which the last two produced byte-identical output and the first two
// differed only in whether a time was shown. Callers picked between them by
// guessing, which is how the same timestamp came to render four ways.
