import { queryDbMPMHRGA } from "../db/mssql.js";
import { pool, query } from "../db/postgres.js";
import type { SyncResult } from "../types.js";
import { buildCompanyIdFilter } from "./sync-helpers.js";
import { summarizeParts } from "./sync-summary.js";

type PositionRow = {
  COMPANY_ID: string;
  POSITION_ID: string;
  INTERNAL_TITLE: string | null;
  EXTERNAL_TITLE: string | null;
  SUMMARY: string | null;
  GRADE_ID: string | null;
  POS_LEVEL_NO: number | null;
  VALID_FROM: Date | null;
  VALID_TO: Date | null;
  CREATE_BY: string | null;
  CREATE_DATE: Date | null;
  MODI_BY: string | null;
  MODI_DATE: Date | null;
};

type PositionHierarchyRow = {
  COMPANY_ID: string;
  POSITION_ID: string;
  PARENT_POSITION_ID: string | null;
  VALID_FROM: Date | null;
  VALID_TO: Date | null;
  CREATE_BY: string | null;
  CREATE_DATE: Date | null;
  MODI_BY: string | null;
  MODI_DATE: Date | null;
};

type EmployeePositionRow = {
  COMPANY_ID: string;
  EMPLOYEE_ID: string;
  POSITION_ID: string;
  PRIMARY_POSITION: string | null;
  VALID_FROM: Date | null;
  VALID_TO: Date | null;
  CREATE_BY: string | null;
  CREATE_DATE: Date | null;
  MODI_BY: string | null;
  MODI_DATE: Date | null;
};

type TechCompetencyRow = {
  COMPANY_ID: string;
  EMPLOYEE_ID: string;
  COMPANY_OFFICE: string | null;
  COST_CENTER: string | null;
  ORG_ID: string | null;
  POSITION_ID: string | null;
  GRADE_ID: string | null;
  TECHNICAL_ID: string;
  TECHNICAL_NAME: string | null;
  PROFICIENCY_ID: string | null;
  PROFICIENCY_NAME: string | null;
  SCORE: number | null;
  CURRENT_PROFICIENCY_ID: string | null;
  CURRENT_PROFICIENCY_NAME: string | null;
  CURRENT_SCORE: number | null;
  GAP: number | null;
  IS_ACTIVE: number | null;
  CREATE_BY: string | null;
  CREATE_DATE: Date | null;
  MODI_BY: string | null;
  MODI_DATE: Date | null;
};

function asBooleanFlag(value: string | null): boolean {
  return value != null && value.trim().toUpperCase() === "Y";
}

function getTechSourceKey(row: TechCompetencyRow): string {
  return `${row.COMPANY_ID}:${String(row.EMPLOYEE_ID)}:${row.POSITION_ID ?? "-"}:${String(row.TECHNICAL_ID)}`;
}

function getTechRowStamp(row: TechCompetencyRow): number {
  return row.MODI_DATE?.getTime() ?? row.CREATE_DATE?.getTime() ?? 0;
}

export async function syncPositionMaster(companyIds: string[] | null = null): Promise<SyncResult> {
  const companyFilter = buildCompanyIdFilter("COMPANY_ID", companyIds);
  const filterDesc = companyIds && companyIds.length > 0 ? ` [companyIds=${companyIds.join(",")}]` : "";
  console.log(`[SYNC] Starting position master sync from DB MPMHRGA${filterDesc}`);

  const rows = await queryDbMPMHRGA<PositionRow>(
    `SELECT
      COMPANY_ID, POSITION_ID, INTERNAL_TITLE, EXTERNAL_TITLE, SUMMARY,
      GRADE_ID, POS_LEVEL_NO, VALID_FROM, VALID_TO,
      CREATE_BY, CREATE_DATE, MODI_BY, MODI_DATE
    FROM dbo.DVP_POSITION_TBL
    WHERE POSITION_ID IS NOT NULL${companyFilter.sql}
    ORDER BY COMPANY_ID, POSITION_ID, VALID_FROM`,
    companyFilter.params,
  );

  if (rows.length === 0) {
    return { success: true, message: `No position master records in DB MPMHRGA${filterDesc}`, synced: 0, total: 0 };
  }

  const BATCH = 500;
  let synced = 0;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const values: unknown[] = [];
      const placeholders: string[] = [];
      let idx = 1;

      for (const r of batch) {
        placeholders.push(
          `($${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},NOW())`
        );
        values.push(
          r.COMPANY_ID,
          String(r.POSITION_ID),
          r.INTERNAL_TITLE,
          r.EXTERNAL_TITLE,
          r.SUMMARY,
          r.GRADE_ID,
          r.POS_LEVEL_NO,
          r.VALID_FROM,
          r.VALID_TO,
          r.CREATE_BY,
          r.CREATE_DATE,
          r.MODI_BY,
          r.MODI_DATE
        );
      }

      await client.query(
        `INSERT INTO sync_positions
          (company_id, position_id, internal_title, external_title, summary,
           grade_id, pos_level_no, valid_from, valid_to,
           create_by, create_date, modi_by, modi_date, synced_at)
         VALUES ${placeholders.join(",")}
         ON CONFLICT (company_id, position_id, valid_from) DO UPDATE SET
          internal_title = EXCLUDED.internal_title,
          external_title = EXCLUDED.external_title,
          summary = EXCLUDED.summary,
          grade_id = EXCLUDED.grade_id,
          pos_level_no = EXCLUDED.pos_level_no,
          valid_to = EXCLUDED.valid_to,
          create_by = EXCLUDED.create_by,
          create_date = EXCLUDED.create_date,
          modi_by = EXCLUDED.modi_by,
          modi_date = EXCLUDED.modi_date,
          synced_at = EXCLUDED.synced_at`,
        values
      );

      synced += batch.length;
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return { success: true, synced, total: rows.length, message: `Synced ${synced} position master rows${filterDesc}` };
}

export async function syncPositionHierarchy(companyIds: string[] | null = null): Promise<SyncResult> {
  const companyFilter = buildCompanyIdFilter("COMPANY_ID", companyIds);
  const filterDesc = companyIds && companyIds.length > 0 ? ` [companyIds=${companyIds.join(",")}]` : "";
  console.log(`[SYNC] Starting position hierarchy sync from DB MPMHRGA${filterDesc}`);

  const rows = await queryDbMPMHRGA<PositionHierarchyRow>(
    `SELECT
      COMPANY_ID, POSITION_ID, PARENT_POSITION_ID,
      VALID_FROM, VALID_TO,
      CREATE_BY, CREATE_DATE, MODI_BY, MODI_DATE
    FROM dbo.DVP_POSITION_STRUCTURE_TBL
    WHERE POSITION_ID IS NOT NULL${companyFilter.sql}
    ORDER BY COMPANY_ID, POSITION_ID, VALID_FROM`,
    companyFilter.params,
  );

  if (rows.length === 0) {
    return { success: true, message: `No hierarchy records in DB MPMHRGA${filterDesc}`, synced: 0, total: 0 };
  }

  const BATCH = 500;
  let synced = 0;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const values: unknown[] = [];
      const placeholders: string[] = [];
      let idx = 1;

      for (const r of batch) {
        placeholders.push(
          `($${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},NOW())`
        );
        values.push(
          r.COMPANY_ID,
          String(r.POSITION_ID),
          r.PARENT_POSITION_ID,
          r.VALID_FROM,
          r.VALID_TO,
          r.CREATE_BY,
          r.CREATE_DATE,
          r.MODI_BY,
          r.MODI_DATE,
          `${r.COMPANY_ID}:${String(r.POSITION_ID)}:${r.VALID_FROM?.toISOString() ?? "null"}`
        );
      }

      await client.query(
        `INSERT INTO sync_position_hierarchy
          (company_id, position_id, parent_position_id, valid_from, valid_to,
           create_by, create_date, modi_by, modi_date, source_key, synced_at)
         VALUES ${placeholders.join(",")}
         ON CONFLICT (source_key) DO UPDATE SET
          parent_position_id = EXCLUDED.parent_position_id,
          valid_to = EXCLUDED.valid_to,
          create_by = EXCLUDED.create_by,
          create_date = EXCLUDED.create_date,
          modi_by = EXCLUDED.modi_by,
          modi_date = EXCLUDED.modi_date,
          synced_at = EXCLUDED.synced_at`,
        values
      );

      synced += batch.length;
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return { success: true, synced, total: rows.length, message: `Synced ${synced} position hierarchy rows${filterDesc}` };
}

export async function syncEmployeePositions(companyIds: string[] | null = null): Promise<SyncResult> {
  const companyFilter = buildCompanyIdFilter("COMPANY_ID", companyIds);
  const filterDesc = companyIds && companyIds.length > 0 ? ` [companyIds=${companyIds.join(",")}]` : "";
  console.log(`[SYNC] Starting employee-position mapping sync from DB MPMHRGA${filterDesc}`);

  const rows = await queryDbMPMHRGA<EmployeePositionRow>(
    `SELECT
      COMPANY_ID, EMPLOYEE_ID, POSITION_ID, PRIMARY_POSITION,
      VALID_FROM, VALID_TO,
      CREATE_BY, CREATE_DATE, MODI_BY, MODI_DATE
    FROM dbo.DVP_EMPLOYEE_POSITION_TBL
    WHERE EMPLOYEE_ID IS NOT NULL
      AND POSITION_ID IS NOT NULL${companyFilter.sql}
    ORDER BY COMPANY_ID, EMPLOYEE_ID, VALID_FROM`,
    companyFilter.params,
  );

  if (rows.length === 0) {
    return { success: true, message: `No employee-position records in DB MPMHRGA${filterDesc}`, synced: 0, total: 0 };
  }

  const BATCH = 500;
  let synced = 0;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const values: unknown[] = [];
      const placeholders: string[] = [];
      let idx = 1;

      for (const r of batch) {
        placeholders.push(
          `($${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},NOW())`
        );
        values.push(
          r.COMPANY_ID,
          String(r.EMPLOYEE_ID),
          String(r.POSITION_ID),
          asBooleanFlag(r.PRIMARY_POSITION),
          r.VALID_FROM,
          r.VALID_TO,
          r.CREATE_BY,
          r.CREATE_DATE,
          r.MODI_BY,
          r.MODI_DATE,
          `${r.COMPANY_ID}:${String(r.EMPLOYEE_ID)}:${String(r.POSITION_ID)}:${r.VALID_FROM?.toISOString() ?? "null"}`
        );
      }

      await client.query(
        `INSERT INTO sync_employee_positions
          (company_id, employee_id, position_id, primary_position, valid_from, valid_to,
           create_by, create_date, modi_by, modi_date, source_key, synced_at)
         VALUES ${placeholders.join(",")}
         ON CONFLICT (source_key) DO UPDATE SET
          primary_position = EXCLUDED.primary_position,
          valid_to = EXCLUDED.valid_to,
          create_by = EXCLUDED.create_by,
          create_date = EXCLUDED.create_date,
          modi_by = EXCLUDED.modi_by,
          modi_date = EXCLUDED.modi_date,
          synced_at = EXCLUDED.synced_at`,
        values
      );

      synced += batch.length;
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return { success: true, synced, total: rows.length, message: `Synced ${synced} employee-position rows${filterDesc}` };
}

export async function syncTechnicalCompetencyMappings(companyIds: string[] | null = null): Promise<SyncResult> {
  const companyFilter = buildCompanyIdFilter("COMPANY_ID", companyIds);
  const filterDesc = companyIds && companyIds.length > 0 ? ` [companyIds=${companyIds.join(",")}]` : "";
  console.log(`[SYNC] Starting technical competency mapping sync from DB MPMHRGA${filterDesc}`);

  const rows = await queryDbMPMHRGA<TechCompetencyRow>(
    `SELECT
      COMPANY_ID, EMPLOYEE_ID, COMPANY_OFFICE, COST_CENTER, ORG_ID,
      POSITION_ID, GRADE_ID, TECHNICAL_ID, TECHNICAL_NAME,
      PROFICIENCY_ID, PROFICIENCY_NAME, SCORE,
      CURRENT_PROFICIENCY_ID, CURRENT_PROFICIENCY_NAME, CURRENT_SCORE,
      GAP, IS_ACTIVE, CREATE_BY, CREATE_DATE, MODI_BY, MODI_DATE
    FROM dbo.DVP_TECH_COMPETENCY_MAP_SUBDTL
    WHERE EMPLOYEE_ID IS NOT NULL
      AND TECHNICAL_ID IS NOT NULL${companyFilter.sql}
    ORDER BY COMPANY_ID, EMPLOYEE_ID, TECHNICAL_ID`,
    companyFilter.params,
  );

  if (rows.length === 0) {
    return { success: true, message: `No technical competency mappings in DB MPMHRGA${filterDesc}`, synced: 0, total: 0 };
  }

  const uniqueRows = new Map<string, TechCompetencyRow>();
  for (const row of rows) {
    const sourceKey = getTechSourceKey(row);
    const current = uniqueRows.get(sourceKey);
    if (!current || getTechRowStamp(row) >= getTechRowStamp(current)) {
      uniqueRows.set(sourceKey, row);
    }
  }

  const dedupedRows = Array.from(uniqueRows.values());
  if (dedupedRows.length !== rows.length) {
    console.log(`[SYNC] Deduplicated technical competency rows from ${rows.length} to ${dedupedRows.length}`);
  }

  const BATCH = 500;
  let synced = 0;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    for (let i = 0; i < dedupedRows.length; i += BATCH) {
      const batch = dedupedRows.slice(i, i + BATCH);
      const values: unknown[] = [];
      const placeholders: string[] = [];
      let idx = 1;

      for (const r of batch) {
        placeholders.push(
          `($${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},NOW())`
        );
        values.push(
          r.COMPANY_ID,
          String(r.EMPLOYEE_ID),
          r.COMPANY_OFFICE,
          r.COST_CENTER,
          r.ORG_ID,
          r.POSITION_ID,
          r.GRADE_ID,
          String(r.TECHNICAL_ID),
          r.TECHNICAL_NAME,
          r.PROFICIENCY_ID,
          r.PROFICIENCY_NAME,
          r.SCORE,
          r.CURRENT_PROFICIENCY_ID,
          r.CURRENT_PROFICIENCY_NAME,
          r.CURRENT_SCORE,
          r.GAP,
          Boolean(r.IS_ACTIVE),
          r.CREATE_BY,
          r.CREATE_DATE,
          r.MODI_BY,
          r.MODI_DATE,
          getTechSourceKey(r)
        );
      }

      await client.query(
        `INSERT INTO sync_technical_competencies
          (company_id, employee_id, company_office, cost_center, org_id,
           position_id, grade_id, technical_id, technical_name,
           proficiency_id, proficiency_name, score,
           current_proficiency_id, current_proficiency_name, current_score,
           gap, is_active, create_by, create_date, modi_by, modi_date, source_key, synced_at)
         VALUES ${placeholders.join(",")}
         ON CONFLICT (source_key) DO UPDATE SET
          company_office = EXCLUDED.company_office,
          cost_center = EXCLUDED.cost_center,
          org_id = EXCLUDED.org_id,
          position_id = EXCLUDED.position_id,
          grade_id = EXCLUDED.grade_id,
          technical_name = EXCLUDED.technical_name,
          proficiency_id = EXCLUDED.proficiency_id,
          proficiency_name = EXCLUDED.proficiency_name,
          score = EXCLUDED.score,
          current_proficiency_id = EXCLUDED.current_proficiency_id,
          current_proficiency_name = EXCLUDED.current_proficiency_name,
          current_score = EXCLUDED.current_score,
          gap = EXCLUDED.gap,
          is_active = EXCLUDED.is_active,
          create_by = EXCLUDED.create_by,
          create_date = EXCLUDED.create_date,
          modi_by = EXCLUDED.modi_by,
          modi_date = EXCLUDED.modi_date,
          synced_at = EXCLUDED.synced_at`,
        values
      );

      synced += batch.length;
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return { success: true, synced, total: dedupedRows.length, message: `Synced ${synced} technical competency rows${filterDesc}` };
}

export async function populatePositions(companyIds: string[] | null = null): Promise<SyncResult> {
  const cteFilter = buildCompanyIdFilter("sep.company_id", companyIds, { dialect: "pg" });
  const outerFilter = buildCompanyIdFilter("sp.company_id", companyIds, {
    dialect: "pg",
    offset: cteFilter.params.length,
  });
  const filterDesc = companyIds && companyIds.length > 0 ? ` [companyIds=${companyIds.join(",")}]` : "";
  console.log(`[SYNC] Starting populate positions from sync_positions${filterDesc}`);

  const rows = await query<{
    sync_position_id: number;
    company_id: string;
    position_id: string;
    internal_title: string | null;
    external_title: string | null;
    department: string | null;
    division: string | null;
    summary: string | null;
    grade_id: string | null;
    tenant_id: string;
  }>(
    `WITH position_employee_context AS (
      SELECT DISTINCT ON (sctm.tenant_id, sep.position_id)
        sctm.tenant_id,
        sep.position_id,
        e.department,
        e.division
      FROM sync_employee_positions sep
      INNER JOIN sync_employees e ON e.company_id = sep.company_id AND sep.employee_id = LPAD(e.employee_id::text, 5, '0')
      INNER JOIN sync_company_tenant_map sctm ON sep.company_id = sctm.company_id AND sctm.is_active = true
      WHERE sep.position_id IS NOT NULL
        AND sctm.tenant_id IS NOT NULL
        AND sep.primary_position = true
        AND (sep.valid_from <= NOW() OR sep.valid_from IS NULL)
        AND (sep.valid_to IS NULL OR sep.valid_to >= NOW())${cteFilter.sql}
      ORDER BY sctm.tenant_id, sep.position_id, sep.valid_from DESC NULLS LAST, sep.id DESC
    )
    SELECT DISTINCT ON (sctm.tenant_id, sp.position_id)
      sp.id as sync_position_id,
      sp.company_id,
      sp.position_id,
      sp.internal_title,
      sp.external_title,
      sp.summary,
      sp.grade_id,
      sctm.tenant_id,
      pec.department,
      pec.division
    FROM sync_positions sp
    LEFT JOIN sync_company_tenant_map sctm ON sp.company_id = sctm.company_id AND sctm.is_active = true
    LEFT JOIN position_employee_context pec ON pec.tenant_id = sctm.tenant_id AND pec.position_id = sp.position_id
    WHERE sp.position_id IS NOT NULL AND sctm.tenant_id IS NOT NULL${outerFilter.sql}
    ORDER BY sctm.tenant_id, sp.position_id, sp.valid_from DESC NULLS LAST, sp.id DESC`,
    [...cteFilter.params, ...outerFilter.params],
  );

  if (rows.length === 0) {
    return { success: true, message: `No positions to populate${filterDesc}`, synced: 0, total: 0 };
  }

  const BATCH = 500;
  let synced = 0;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const values: unknown[] = [];
      const placeholders: string[] = [];
      let idx = 1;

      for (const r of batch) {
        placeholders.push(
          `($${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},NOW(),NOW())`
        );
        values.push(
          r.tenant_id,
          r.sync_position_id,
          r.position_id,
          r.internal_title,
          r.external_title,
          r.summary,
          r.grade_id,
          r.department,
          r.division
        );
      }

      await client.query(
        `INSERT INTO positions
          (tenant_id, sync_position_id, position_id, internal_title, external_title, summary, grade_id, department, division, created_at, updated_at)
         VALUES ${placeholders.join(",")}
         ON CONFLICT (tenant_id, position_id) DO UPDATE SET
          sync_position_id = EXCLUDED.sync_position_id,
          internal_title = EXCLUDED.internal_title,
          external_title = EXCLUDED.external_title,
          summary = EXCLUDED.summary,
          grade_id = EXCLUDED.grade_id,
          department = EXCLUDED.department,
          division = EXCLUDED.division,
          updated_at = EXCLUDED.updated_at`,
        values
      );

      synced += batch.length;
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return { success: true, synced, total: rows.length, message: `Populated ${synced} positions${filterDesc}` };
}

export async function syncPositionBundle(companyIds: string[] | null = null): Promise<
  SyncResult & {
    positionMaster: SyncResult;
    positionHierarchy: SyncResult;
    employeePositions: SyncResult;
    technicalCompetencies: SyncResult;
    positionsPopulated: SyncResult;
  }
> {
  const positionMaster = await syncPositionMaster(companyIds);
  const positionHierarchy = await syncPositionHierarchy(companyIds);
  const employeePositions = await syncEmployeePositions(companyIds);
  const technicalCompetencies = await syncTechnicalCompetencyMappings(companyIds);
  const positionsPopulated = await populatePositions(companyIds);

  // Envelope first, parts second — see summarizeParts for why this exists.
  const parts = {
    positionMaster,
    positionHierarchy,
    employeePositions,
    technicalCompetencies,
    positionsPopulated,
  };
  return { ...summarizeParts(parts), ...parts };
}
