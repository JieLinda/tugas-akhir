import { queryDbMPMDS, queryDbMPMHRGA, closePools } from "../db/mssql.js";

type ColRow = {
  TABLE_NAME: string;
  COLUMN_NAME: string;
  DATA_TYPE: string;
  IS_NULLABLE: string;
};

async function showCols(label: string, rows: ColRow[]) {
  console.log(`\n=== ${label} ===`);
  if (!rows.length) { console.log("  (no rows)"); return; }
  for (const c of rows)
    console.log(`  ${c.COLUMN_NAME.padEnd(40)} ${c.DATA_TYPE.padEnd(20)} NULL=${c.IS_NULLABLE}`);
}

async function colsA(table: string) {
  return queryDbMPMDS<ColRow>(`
    SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${table}' ORDER BY ORDINAL_POSITION`);
}

async function colsB(table: string) {
  return queryDbMPMHRGA<ColRow>(`
    SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${table}' ORDER BY ORDINAL_POSITION`);
}

async function main() {
  await showCols("DB MPMDS: MPMDS_ORANGE_DATA", await colsA("MPMDS_ORANGE_DATA"));
  await showCols("DB MPMHRGA: DVP_PA_HISTORY_HDR", await colsB("DVP_PA_HISTORY_HDR"));
  await showCols("DB MPMHRGA: DVP_PA_HISTORY_DTL", await colsB("DVP_PA_HISTORY_DTL"));
  await showCols("DB MPMHRGA: DVP_EMPLOYEE_TBL", await colsB("DVP_EMPLOYEE_TBL"));
  await showCols("DB MPMHRGA: DVP_PERSON_TBL", await colsB("DVP_PERSON_TBL"));
  await showCols("DB MPMHRGA: DVP_PERSON_EDUCATION_TBL", await colsB("DVP_PERSON_EDUCATION_TBL"));
  await closePools();
}

main().catch((e) => { console.error(e); process.exit(1); });
