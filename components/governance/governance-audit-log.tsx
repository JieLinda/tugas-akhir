'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { DatePicker } from '@/components/ui/date-picker';
import { CaretLeftIcon, CaretRightIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import { formatDateTime, toDayKey } from '@/lib/datetime';

import { listAuditLogAction } from '@/lib/audit-actions';
import type { AuditEntrySerialized } from './governance-types';

const PAGE_SIZE = 50;

type AuditLogTabProps = {
  initialEntries: AuditEntrySerialized[];
  initialTotal: number;
};

export function AuditLogTab({ initialEntries, initialTotal }: AuditLogTabProps) {
  const [entries, setEntries] = useState(initialEntries);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  const [search, setSearch] = useState('');
  const now = new Date();
  const [fromDate, setFromDate] = useState<Date | undefined>(new Date(now.getFullYear(), now.getMonth(), 1));
  const [toDate, setToDate] = useState<Date | undefined>(now);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    return () => clearTimeout(debounceRef.current);
  }, []);

  // Fetch with default date range on mount
  useEffect(() => {
    fetchEntries(1, search, fromDate, toDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchEntries = useCallback(async (p: number, s: string, fd: Date | undefined, td: Date | undefined) => {
    setLoading(true);
    const formData = new FormData();
    formData.set('page', String(p));
    formData.set('pageSize', String(PAGE_SIZE));
    if (s.trim()) formData.set('search', s.trim());
    // Send the calendar day the user picked, not toISOString(): the picker
    // yields LOCAL midnight, so in WIB toISOString() rolls it back to 17:00 the
    // previous day and the filter silently drops a day's worth of entries.
    if (fd) formData.set('fromDate', toDayKey(fd) ?? '');
    if (td) formData.set('toDate', toDayKey(td) ?? '');
    try {
      const result = await listAuditLogAction(formData);
      setEntries(result.entries);
      setTotal(result.total);
    } catch (err: any) {
      toast.error(err?.message ?? 'Gagal memuat audit log.');
    } finally {
      setLoading(false);
    }
  }, []);

  function triggerFetch(p: number) {
    setEntries([]);
    fetchEntries(p, search, fromDate, toDate);
  }

  function applyFilters() {
    setPage(1);
    triggerFetch(1);
  }

  function clearFilters() {
    setSearch('');
    setFromDate(undefined);
    setToDate(undefined);
    setPage(1);
    fetchEntries(1, '', undefined, undefined);
  }

  const activeFilters = search || fromDate || toDate;

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        {/* Search + date range + clear */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" weight="duotone" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                clearTimeout(debounceRef.current);
                debounceRef.current = setTimeout(() => {
                  setPage(1);
                  fetchEntries(1, e.target.value, fromDate, toDate);
                }, 400);
              }}
              placeholder="Cari ringkasan..."
              className="pl-9 h-9 text-sm"
            />
          </div>
          {/* The range can never invert: picking a start past the end drags the
              end along, and vice versa. The server swaps an inverted pair too,
              but the guard belongs here so the pickers never SHOW one. */}
          <DatePicker
            value={fromDate}
            onChange={(d) => {
              setFromDate(d);
              if (d && toDate && d > toDate) setToDate(d);
            }}
            placeholder="Dari tanggal"
          />
          <span className="text-xs text-muted-foreground">s/d</span>
          <DatePicker
            value={toDate}
            onChange={(d) => {
              setToDate(d);
              if (d && fromDate && d < fromDate) setFromDate(d);
            }}
            placeholder="Sampai tanggal"
          />
          <Button size="sm" onClick={applyFilters} className="h-9 text-xs">
            Terapkan
          </Button>
          {activeFilters && (
            <Button size="sm" variant="ghost" onClick={clearFilters} className="h-9 text-xs text-muted-foreground">
              Hapus filter
            </Button>
          )}
        </div>

        {/* Info bar */}
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {loading && <span className="mr-2 inline-block animate-spin">⟳</span>}
            {total === 0
              ? 'Tidak ada aktivitas ditemukan'
              : `Menampilkan ${Math.min((safePage - 1) * PAGE_SIZE + 1, total)}-${Math.min(safePage * PAGE_SIZE, total)} dari ${total} aktivitas`}
          </span>
        </div>

        {/* Table */}
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Waktu</TableHead>
                <TableHead>Aktor</TableHead>
                <TableHead>Aksi</TableHead>
                <TableHead>Entitas</TableHead>
                <TableHead>Ringkasan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    Belum ada aktivitas tercatat.
                  </TableCell>
                </TableRow>
              ) : (
                entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDateTime(entry.createdAt)}
                    </TableCell>
                    <TableCell className="text-sm">{entry.actorName}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {entry.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {entry.entityType}
                      {entry.entityId && (
                        <span className="ml-1 font-mono text-[10px]">
                          {entry.entityId.slice(0, 8)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-sm">
                      {entry.summary ?? '—'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3">
            <Button variant="outline" size="sm" disabled={safePage <= 1} onClick={() => { const next = Math.max(1, safePage - 1); setPage(next); triggerFetch(next); }}>
              <CaretLeftIcon className="h-4 w-4" weight="bold" />
            </Button>
            <span className="text-sm text-muted-foreground tabular-nums">
              {safePage} / {totalPages}
            </span>
            <Button variant="outline" size="sm" disabled={safePage >= totalPages} onClick={() => { const next = Math.min(totalPages, safePage + 1); setPage(next); triggerFetch(next); }}>
              <CaretRightIcon className="h-4 w-4" weight="bold" />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
