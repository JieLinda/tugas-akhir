// Accepted values of the enumerated candidate fields, shared by the real
// candidate actions (lib/pulse-crud-actions.ts) and the demo-mode edit
// (lib/demo/candidate-demo-actions.ts) so both validate a form the same way.
import type { DisciplineStatus, McuStatus } from '@/lib/db/schema';

export const DISCIPLINE_VALUES = ['CLEAR', 'ST', 'ACTIVE_SP', 'SP_UNDER_2_YEARS', 'SP3', 'SP_FIRST_LAST', 'WARNING', 'SANCTION'] as const satisfies readonly DisciplineStatus[];
export const MCU_VALUES = ['fit', 'fit_with_note', 'unfit', 'expired'] as const satisfies readonly McuStatus[];
export const PERFORMANCE_VALUES = ['A', 'B', 'C', 'D', 'E'] as const;
