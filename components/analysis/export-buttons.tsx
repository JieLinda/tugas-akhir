'use client';

import { useState } from 'react';
import { Download, FileSpreadsheet, FileText, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { exportAnalysisWorkbook, exportRunHtml, type ExportPayload } from '@/lib/analysis-export';
import type { AnalysisCandidate } from '@/lib/analysis-utils';
import type { PositionSummary } from '@/lib/talent-data';

export type ExportFilterSummary = {
  qualified: number;
  rejected: number;
  topScore: number;
};

interface ExportButtonsProps {
  position: PositionSummary;
  /** In the order the screen lists them, so the file's rows match the screen's. */
  rankedCandidates: AnalysisCandidate[];
  selectedCandidate?: AnalysisCandidate | null;
  compareCandidate?: AnalysisCandidate | null;
  filterSummary: ExportFilterSummary;
  /** The run's scoring method (`AHP_TOPSIS` / `LLM`). */
  method: string | null;
  /** Candidates marked "dikecualikan" on this run: id → reason text. */
  exclusions?: ReadonlyMap<string, string>;
  variant?: 'default' | 'outline';
  size?: 'default' | 'sm';
}

export function ExportButtons({
  position,
  rankedCandidates,
  selectedCandidate,
  compareCandidate,
  filterSummary,
  method,
  exclusions,
  variant = 'outline',
  size = 'sm',
}: ExportButtonsProps) {
  const [busy, setBusy] = useState(false);

  const basePayload: ExportPayload = {
    position,
    rankedCandidates,
    selectedCandidate: selectedCandidate ?? null,
    compareCandidate: compareCandidate ?? null,
    filterSummary,
    method,
    exclusions,
  };

  async function handleExport(type: 'xlsx' | 'html') {
    setBusy(true);
    try {
      if (type === 'xlsx') {
        await exportAnalysisWorkbook(basePayload);
      } else {
        exportRunHtml(basePayload);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size={size} disabled={busy}>
          <Download className="mr-1 h-4 w-4" />
          {busy ? 'Mengekspor...' : 'Ekspor'}
          <ChevronDown className="ml-1 h-3 w-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onClick={() => handleExport('xlsx')} className="gap-2">
          <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
          <div className="flex flex-col">
            <span className="text-sm font-medium">Export Run (Excel)</span>
            <span className="text-[10px] text-muted-foreground">Spreadsheet dengan ringkasan & detail kandidat</span>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport('html')} className="gap-2">
          <FileText className="h-4 w-4 text-rose-600" />
          <div className="flex flex-col">
            <span className="text-sm font-medium">Cetak Run (HTML)</span>
            <span className="text-[10px] text-muted-foreground">Laporan lengkap untuk manajemen</span>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
