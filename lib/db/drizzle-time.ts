/**
 * Makes Drizzle's timestamp mapping agree with `pg-time.ts`.
 *
 * The driver-level pin in `pg-time.ts` is NOT enough for the web app, and the
 * reason is easy to miss: drizzle-orm's node-postgres session passes a
 * per-query `types.getTypeParser` override that returns TIMESTAMP / DATE /
 * TIMESTAMPTZ as raw strings (see node_modules/drizzle-orm/node-postgres/
 * session.js), so the module-global parsers never run for any Drizzle query.
 * Drizzle then maps the string itself, and for `timestamp without time zone`
 * its `PgTimestamp.mapFromDriverValue` is
 *
 *     new Date(value + "+0000")
 *
 * — it declares a WIB wall-clock to be UTC. Every ORM-read naive timestamp in
 * this app was therefore an instant 7 hours late ON EVERY HOST (the container
 * bug needed a UTC host; this one does not), and rendering it in Asia/Jakarta
 * printed 20:02 for a run created at 13:02. `db.execute(sql``)` results were
 * unaffected only by accident: they skip column mapping and arrive as strings.
 *
 * The write side has the mirrored defect: `mapToDriverValue` is
 * `value.toISOString()`, which serialises UTC wall-clock into a naive column
 * regardless of the process TZ — so `TZ=Asia/Jakarta` in docker-compose fixes
 * raw-`pg` writes but NOT Drizzle ORM writes. That is what produced
 * 7.00-hour-skewed `updated_at` rows.
 *
 * Two patch shapes because Drizzle gives us two shapes to patch:
 *   - `mapFromDriverValue` is a prototype METHOD → patched once, globally,
 *     covering `db`, `vectorDb`, and any script that builds its own instance.
 *   - `mapToDriverValue` is a per-instance arrow-function FIELD, assigned at
 *     column construction → prototype patching cannot reach it, so
 *     `installDrizzleTimeMappers` also walks the given schema modules and
 *     overwrites it on every naive-timestamp column instance.
 *
 * `timestamptz` columns are deliberately untouched on both sides: their wire
 * strings carry an offset and `toISOString()` names the correct instant.
 */

import { getTableColumns, is } from 'drizzle-orm';
import { PgTable, PgTimestamp } from 'drizzle-orm/pg-core';
import { parseNaiveTimestamp } from './pg-time';

/**
 * A JS Date as the WIB wall-clock literal Postgres should store in a
 * `timestamp without time zone` column: `2026-08-24 13:02:51.743`.
 *
 * Shift-then-read-UTC is exact because WIB is a fixed +07:00 with no DST —
 * the same assumption `pg-time.ts` documents for the read side.
 */
function naiveWibLiteral(date: Date): string {
  const shifted = new Date(date.getTime() + 7 * 3_600_000);
  return shifted.toISOString().slice(0, 23).replace('T', ' ');
}

let prototypePatched = false;

/**
 * Idempotent for the prototype; safe to call once per schema module. Must run
 * before the first ORM query — both `lib/db/index.ts` and `lib/db/vector-db.ts`
 * call it right after creating their drizzle instance.
 */
export function installDrizzleTimeMappers(
  ...schemaModules: Record<string, unknown>[]
): void {
  if (!prototypePatched) {
    prototypePatched = true;
    const proto = PgTimestamp.prototype as unknown as {
      withTimezone: boolean;
      mapFromDriverValue(value: unknown): unknown;
    };
    const original = proto.mapFromDriverValue;
    proto.mapFromDriverValue = function (this: typeof proto, value: unknown) {
      if (typeof value === 'string' && !this.withTimezone) {
        return parseNaiveTimestamp(value);
      }
      return original.call(this, value);
    };
  }

  for (const schemaModule of schemaModules) {
    for (const exported of Object.values(schemaModule)) {
      if (!is(exported, PgTable)) continue;
      for (const column of Object.values(getTableColumns(exported))) {
        if (!is(column, PgTimestamp)) continue;
        const col = column as unknown as {
          withTimezone: boolean;
          mapToDriverValue: (value: Date) => string;
        };
        if (col.withTimezone) continue;
        col.mapToDriverValue = naiveWibLiteral;
      }
    }
  }
}
