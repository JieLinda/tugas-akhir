'use client';

import { useState } from 'react';
import { ChevronDown, Download, FileSpreadsheet, FileText, FileType2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  exportChat,
  hasExportableChat,
  type ChatExportFormat,
  type ChatExportMessage,
  type ChatExportMeta,
} from '@/lib/chat-export';

interface ChatExportMenuProps {
  messages: ChatExportMessage[];
  meta: ChatExportMeta;
  /** True while an answer is still streaming — see the note below. */
  streaming?: boolean;
}

const FORMATS: {
  format: ChatExportFormat;
  label: string;
  hint: string;
  Icon: typeof FileText;
  tone: string;
}[] = [
  {
    format: 'pdf',
    label: 'PDF',
    hint: 'Arsip siap cetak dengan penomoran halaman',
    Icon: FileText,
    tone: 'text-rose-600',
  },
  {
    format: 'docx',
    label: 'Word (.docx)',
    hint: 'Bisa diedit dan ditempel ke memo HR',
    Icon: FileType2,
    tone: 'text-blue-600',
  },
  {
    format: 'xlsx',
    label: 'Excel (.xlsx)',
    hint: 'Satu baris per pesan + tabel jawaban AI jadi sel',
    Icon: FileSpreadsheet,
    tone: 'text-emerald-600',
  },
];

export function ChatExportMenu({ messages, meta, streaming = false }: ChatExportMenuProps) {
  const [busy, setBusy] = useState<ChatExportFormat | null>(null);

  async function handleExport(format: ChatExportFormat) {
    if (!hasExportableChat(messages)) {
      toast.error('Belum ada pesan untuk diekspor.');
      return;
    }
    setBusy(format);
    try {
      await exportChat(format, { meta, messages });
      toast.success(`Riwayat chat diekspor ke ${format.toUpperCase()}.`);
    } catch (err) {
      // jspdf/xlsx are dynamic imports; a chunk that fails to load must say so
      // rather than leave the button spinning with no file appearing.
      toast.error(err instanceof Error ? err.message : 'Gagal mengekspor riwayat chat.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" disabled={busy !== null}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          {busy ? 'Mengekspor...' : 'Ekspor'}
          <ChevronDown className="h-3 w-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {FORMATS.map(({ format, label, hint, Icon, tone }) => (
          <DropdownMenuItem key={format} onClick={() => handleExport(format)} className="gap-2">
            <Icon className={`h-4 w-4 ${tone}`} />
            <div className="flex flex-col">
              <span className="text-sm font-medium">{label}</span>
              <span className="text-[10px] text-muted-foreground">{hint}</span>
            </div>
          </DropdownMenuItem>
        ))}
        {streaming && (
          // The in-flight answer is not in the history yet, so it would be
          // missing from the file. Saying so is cheaper than blocking the
          // button on a stream the reader may not care about.
          <div className="px-2 py-1.5 text-[10px] leading-snug text-muted-foreground">
            Jawaban yang sedang ditulis belum termasuk — tunggu selesai untuk menyertakannya.
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
