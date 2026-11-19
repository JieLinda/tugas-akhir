'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Copy,
  Info,
  KeyRound,
  Loader2,
  Lock,
  RefreshCw,
  RotateCcw,
  Server,
  ShieldCheck,
  Unlock,
  WifiOff,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { InfoHint } from '@/components/ui/info-hint';
import { formatDateTime } from '@/lib/datetime';

import {
  getEncryptionStatusAction,
  initializeEncryptionAction,
  lockEncryptionAction,
  rollbackMasterKeyRotationAction,
  rotateMasterKeyAction,
  unlockEncryptionAction,
  type EncryptionStatus,
} from '@/lib/encryption-actions';

type KeyPhase = 'uninitialized' | 'locked' | 'unlocked';

/** Why the key is on screen. Both paths mint a key that can never be shown again. */
type Revealed = { key: string; origin: 'init' | 'rotate' };

type BusyAction = 'init' | 'unlock' | 'lock' | 'rotate' | 'rollback' | null;

const PHASE_META: Record<KeyPhase, { label: string; className: string }> = {
  uninitialized: {
    label: 'Belum diinisialisasi',
    className: 'bg-muted text-muted-foreground border-transparent',
  },
  locked: {
    label: 'Terkunci',
    className: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20',
  },
  unlocked: {
    label: 'Terbuka',
    className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20',
  },
};

export function EncryptionKeyCard({ className }: { className?: string }) {
  const router = useRouter();

  const [status, setStatus] = useState<EncryptionStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<BusyAction>(null);

  const [showInitWarning, setShowInitWarning] = useState(false);
  const [initAck, setInitAck] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  const [unlockInput, setUnlockInput] = useState('');
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlockWarnings, setUnlockWarnings] = useState<string[]>([]);

  const [rotateOpen, setRotateOpen] = useState(false);
  const [rotateInput, setRotateInput] = useState('');
  const [rotateError, setRotateError] = useState<string | null>(null);

  const [revealed, setRevealed] = useState<Revealed | null>(null);
  const [copied, setCopied] = useState(false);

  const refreshStatus = useCallback(async () => {
    setRefreshing(true);
    try {
      setStatus(await getEncryptionStatusAction());
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message || 'Gagal memuat status enkripsi.');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const phase: KeyPhase = !status
    ? 'uninitialized'
    : !status.initialized
      ? 'uninitialized'
      : status.unlocked
        ? 'unlocked'
        : 'locked';

  async function handleInitialize() {
    setBusy('init');
    setInitError(null);
    try {
      const result = await initializeEncryptionAction();
      if (!result.success || !result.masterKey) {
        setInitError(result.message);
        setShowInitWarning(false);
        toast.error('Inisialisasi enkripsi gagal', { description: result.message });
        return;
      }
      setShowInitWarning(false);
      setInitAck(false);
      // The key exists in this variable and nowhere else on the client — no
      // storage, no toast, no console.
      setRevealed({ key: result.masterKey, origin: 'init' });
      await refreshStatus();
      router.refresh();
    } catch (e) {
      const message = (e as Error).message;
      setInitError(message);
      toast.error('Inisialisasi enkripsi gagal', { description: message });
    } finally {
      setBusy(null);
    }
  }

  async function handleUnlock() {
    const key = unlockInput.trim();
    if (!key) {
      setUnlockError('Masukkan kunci master terlebih dahulu.');
      return;
    }
    setBusy('unlock');
    setUnlockError(null);
    setUnlockWarnings([]);
    try {
      const result = await unlockEncryptionAction(key);
      if (!result.success) {
        // Inline, not just a toast: a wrong key is a thing to fix in place, and
        // the toast is gone by the time the user looks back at the field.
        setUnlockError(result.message);
        toast.error('Gagal membuka enkripsi', { description: result.message });
        return;
      }
      setUnlockInput('');
      setUnlockWarnings(result.warnings);
      toast.success('Enkripsi terbuka', {
        description:
          result.warnings.length > 0
            ? `${result.warnings.length} layanan pendamping tidak menerima kunci.`
            : 'Nilai terenkripsi dapat dibaca kembali.',
      });
      await refreshStatus();
      router.refresh();
    } catch (e) {
      setUnlockError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleLock() {
    setBusy('lock');
    try {
      const result = await lockEncryptionAction();
      if (!result.success) {
        toast.error('Gagal mengunci enkripsi', { description: result.message });
        return;
      }
      setUnlockWarnings([]);
      toast.success('Enkripsi dikunci', { description: result.message });
      await refreshStatus();
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function handleRotate() {
    // The current key is read from the key file, so rotation is normally one
    // click. The input is only a recovery path for when the file is missing or
    // out of step with the database — requiring it every time would train
    // people to keep the key somewhere convenient, which defeats the point.
    const key = rotateInput.trim();
    setBusy('rotate');
    setRotateError(null);
    try {
      const result = await rotateMasterKeyAction(key || undefined);
      if (!result.success || !result.masterKey) {
        setRotateError(result.message);
        toast.error('Rotasi kunci gagal', { description: result.message });
        return;
      }
      setRotateInput('');
      setRotateOpen(false);
      setRevealed({ key: result.masterKey, origin: 'rotate' });
      await refreshStatus();
      router.refresh();
    } catch (e) {
      setRotateError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleRollback() {
    setBusy('rollback');
    setRotateError(null);
    try {
      const result = await rollbackMasterKeyRotationAction();
      if (!result.success) {
        setRotateError(result.message);
        toast.error('Pemulihan kunci gagal', { description: result.message });
        return;
      }
      toast.success('Kunci master dipulihkan', { description: result.message });
      await refreshStatus();
      router.refresh();
    } catch (e) {
      setRotateError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleCopy(key: string) {
    try {
      await navigator.clipboard.writeText(key);
      setCopied(true);
      // The toast never carries the key: toasts get screenshotted and shared.
      toast.success('Kunci disalin ke clipboard', {
        description: 'Tempel ke pengelola kata sandi atau brankas sekarang juga.',
      });
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error('Gagal menyalin otomatis', {
        description: 'Blok kunci dapat diseleksi manual, lalu salin dengan Ctrl+C.',
      });
    }
  }

  function dismissRevealed() {
    setRevealed(null);
    setCopied(false);
  }

  const meta = PHASE_META[phase];

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4 text-primary" />
            Kunci Enkripsi
            <InfoHint title="Kunci Enkripsi">
              Kunci master dipegang oleh Anda, bukan oleh server. Kunci ini membuka nilai-nilai sensitif seperti
              kredensial sumber data.
            </InfoHint>
          </CardTitle>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {status && (
            <Badge className={cn('border text-[11px]', meta.className)}>
              {phase === 'unlocked' ? (
                <Unlock className="mr-1 h-3 w-3" />
              ) : phase === 'locked' ? (
                <Lock className="mr-1 h-3 w-3" />
              ) : (
                <KeyRound className="mr-1 h-3 w-3" />
              )}
              {meta.label}
            </Badge>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            disabled={refreshing || busy !== null}
            onClick={() => void refreshStatus()}
          >
            {refreshing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Periksa ulang
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {loadError && (
          <p className="flex items-start gap-2 rounded-md bg-rose-500/10 p-2.5 text-xs leading-snug text-rose-700 dark:text-rose-300">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 break-words">{loadError}</span>
          </p>
        )}

        {!status && !loadError ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Memuat status enkripsi…
          </div>
        ) : status ? (
          <>
            {/* Where the key lives is the first thing to establish: it decides
                whether a restart re-locks the app, and whether the buttons below
                can do anything at all. */}
            <div className="flex items-start gap-2 rounded-md bg-sky-500/10 p-2.5 text-xs leading-relaxed text-sky-700 dark:text-sky-300">
              <Info className="mt-px h-3.5 w-3.5 shrink-0" />
              <div className="min-w-0 space-y-1.5">
                <p>
                  Kunci master disimpan dalam <strong>berkas di server</strong>, bukan di database.
                  Aplikasi membacanya sendiri saat start, jadi restart, deploy, atau crash{' '}
                  <strong>tidak</strong> membuatnya terkunci — sinkronisasi terjadwal tetap jalan
                  tanpa ada yang membuka kunci secara manual.
                </p>
                <p className="font-mono text-[11px] break-all opacity-90">
                  {status.keyFilePath}
                </p>
                <p className="opacity-90">
                  {status.keySource === 'file'
                    ? 'Berkas kunci ditemukan.'
                    : status.keySource === 'env'
                      ? 'Kunci berasal dari environment variable PULSE_MASTER_KEY — dapat dipakai, tetapi tidak dapat dibuat atau dirotasi dari halaman ini.'
                      : 'Berkas kunci belum ada.'}{' '}
                  Yang punya akses <strong>database</strong> saja tidak dapat membaca data
                  terenkripsi; yang punya akses <strong>berkas server</strong> bisa — jaga izin
                  berkas dan cadangkan kuncinya di luar server.
                </p>
              </div>
            </div>

            {phase === 'uninitialized' && (
              <div className="space-y-3">
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Enkripsi belum diaktifkan. Saat diinisialisasi, sistem membuat satu kunci master,
                  menuliskannya ke berkas kunci di server, dan menampilkannya{' '}
                  <strong>sekali saja</strong> agar Anda dapat menyimpan salinan cadangan. Bila
                  berkas itu hilang dan Anda tidak punya salinan, data terenkripsi tidak dapat
                  dipulihkan oleh siapa pun.
                </p>
                {initError && (
                  <p className="flex items-start gap-2 rounded-md bg-rose-500/10 p-2.5 text-xs leading-snug text-rose-700 dark:text-rose-300">
                    <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                    <span className="min-w-0 break-words">{initError}</span>
                  </p>
                )}
                <Button
                  className="gap-1.5"
                  disabled={busy !== null}
                  onClick={() => {
                    setInitAck(false);
                    setShowInitWarning(true);
                  }}
                >
                  <KeyRound className="h-4 w-4" />
                  Inisialisasi Enkripsi
                </Button>
              </div>
            )}

            {phase === 'locked' && (
              <div className="space-y-3">
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Aplikasi tidak memegang kunci. Nilai terenkripsi tidak dapat dibaca dan
                  penyimpanan ke kolom terenkripsi akan ditolak sampai kunci dimasukkan.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="encryption-master-key" className="text-xs text-muted-foreground">
                    Kunci master
                  </Label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      id="encryption-master-key"
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      value={unlockInput}
                      placeholder="Tempel kunci master di sini"
                      className="font-mono text-sm"
                      onChange={(e) => {
                        setUnlockInput(e.target.value);
                        if (unlockError) setUnlockError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void handleUnlock();
                        }
                      }}
                      aria-invalid={unlockError !== null}
                    />
                    <Button
                      className="shrink-0 gap-1.5 sm:w-auto"
                      disabled={busy !== null}
                      onClick={() => void handleUnlock()}
                    >
                      {busy === 'unlock' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Unlock className="h-4 w-4" />
                      )}
                      Buka Kunci
                    </Button>
                  </div>
                  {unlockError && (
                    <p className="flex items-start gap-2 rounded-md bg-rose-500/10 p-2.5 text-xs leading-snug text-rose-700 dark:text-rose-300">
                      <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0 break-words">{unlockError}</span>
                    </p>
                  )}
                </div>
              </div>
            )}

            {phase === 'unlocked' && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  Dibuka pada{' '}
                  <span className="font-medium text-foreground">
                    {formatDateTime(status.unlockedAt)}
                  </span>
                </p>
                <Button
                  variant="outline"
                  className="gap-1.5"
                  disabled={busy !== null}
                  onClick={() => void handleLock()}
                >
                  {busy === 'lock' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Lock className="h-4 w-4" />
                  )}
                  Kunci
                </Button>
              </div>
            )}

            {unlockWarnings.length > 0 && (
              <div className="rounded-md bg-amber-500/10 p-2.5 text-xs leading-snug text-amber-700 dark:text-amber-300">
                <p className="flex items-center gap-2 font-medium">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Kunci tidak sampai ke seluruh layanan
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-7">
                  {unlockWarnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}

            {status.initialized && (
              <>
                <Separator />

                <div className="space-y-2">
                  <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <Server className="h-3.5 w-3.5" />
                    Layanan pendamping
                  </p>
                  {status.services.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Tidak ada layanan pendamping yang dikonfigurasi.
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {status.services.map((service) => (
                        <ServiceRow
                          key={service.name}
                          service={service}
                          appUnlocked={status.unlocked}
                        />
                      ))}
                    </ul>
                  )}
                </div>

                <Separator />

                <Collapsible open={rotateOpen} onOpenChange={setRotateOpen}>
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-2 rounded-md px-1 py-1.5 text-left text-sm font-medium transition-colors hover:bg-muted/60"
                    >
                      <span className="flex items-center gap-2">
                        <RotateCcw className="h-4 w-4 text-muted-foreground" />
                        Rotasi kunci master
                      </span>
                      <ChevronDown
                        className={cn(
                          'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                          rotateOpen && 'rotate-180',
                        )}
                      />
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-3 px-1 pt-3">
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Rotasi hanya membungkus ulang kunci data dengan kunci master baru — tidak ada
                      satu pun nilai yang dienkripsi ulang, sehingga prosesnya cepat dan aman
                      dijalankan kapan saja. Layanan yang sudah terbuka tetap terbuka. Kunci baru
                      langsung ditulis ke berkas kunci, dan kunci lama dicadangkan di sebelahnya.
                    </p>
                    <p className="flex items-start gap-2 rounded-md bg-amber-500/10 p-2.5 text-xs leading-snug text-amber-700 dark:text-amber-300">
                      <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                      <span>
                        Kunci lama <strong>langsung tidak berlaku</strong> begitu rotasi berhasil,
                        dan kunci baru hanya ditampilkan sekali. Perbarui setiap catatan kunci yang
                        Anda simpan.
                      </span>
                    </p>
                    <div className="space-y-2">
                      <Label htmlFor="encryption-current-key" className="text-xs text-muted-foreground">
                        Kunci master saat ini{' '}
                        <span className="font-normal opacity-80">
                          — opsional, hanya bila berkas kunci hilang atau tidak cocok
                        </span>
                      </Label>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Input
                          id="encryption-current-key"
                          type="password"
                          autoComplete="off"
                          spellCheck={false}
                          value={rotateInput}
                          placeholder="Kosongkan untuk memakai kunci dari berkas"
                          className="font-mono text-sm"
                          onChange={(e) => {
                            setRotateInput(e.target.value);
                            if (rotateError) setRotateError(null);
                          }}
                          aria-invalid={rotateError !== null}
                        />
                        <Button
                          variant="outline"
                          className="shrink-0 gap-1.5"
                          disabled={busy !== null}
                          onClick={() => void handleRotate()}
                        >
                          {busy === 'rotate' ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <RotateCcw className="h-4 w-4" />
                          )}
                          Rotasi Kunci
                        </Button>
                      </div>
                      {rotateError && (
                        <p className="flex items-start gap-2 rounded-md bg-rose-500/10 p-2.5 text-xs leading-snug text-rose-700 dark:text-rose-300">
                          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                          <span className="min-w-0 break-words">{rotateError}</span>
                        </p>
                      )}
                    </div>

                    {status.latestBackup && (
                      <div className="space-y-2 rounded-md border border-amber-500/20 bg-amber-500/5 p-3">
                        <p className="flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-300">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                          Pemulihan kunci sebelumnya
                        </p>
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          Ada cadangan dari rotasi terakhir{' '}
                          <span className="font-mono break-all text-[11px]">
                            {status.latestBackup}
                          </span>
                          . Rotasi tidak mengubah kunci data, jadi memulihkan kunci lama hanyalah
                          membungkus ulang kunci data yang sama — nilai terenkripsi tidak terpengaruh.
                          Gunakan ini untuk menguji rotasi dengan aman dan kembali ke kunci semula.
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1.5 border-amber-500/30 text-xs text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"
                          disabled={busy !== null}
                          onClick={() => void handleRollback()}
                        >
                          {busy === 'rollback' ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RotateCcw className="h-3.5 w-3.5" />
                          )}
                          Pulihkan Kunci Sebelumnya
                        </Button>
                      </div>
                    )}
                  </CollapsibleContent>
                </Collapsible>
              </>
            )}
          </>
        ) : null}
      </CardContent>

      {/* ── Pre-initialisation warning ───────────────────────── */}
      <Dialog
        open={showInitWarning}
        onOpenChange={(open) => {
          if (busy === 'init') return;
          setShowInitWarning(open);
          if (!open) setInitAck(false);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />
              Inisialisasi kunci enkripsi
            </DialogTitle>
            <DialogDescription className="text-xs">
              Baca sampai selesai. Langkah ini tidak dapat diulang.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-sm leading-relaxed">
            <p>
              Sistem akan membuat satu kunci master dan menampilkannya{' '}
              <strong>satu kali saja</strong>, pada layar berikutnya. Kunci itu tidak disimpan di
              database, tidak tercatat di log, dan tidak dapat dibuat ulang oleh siapa pun —
              termasuk administrator.
            </p>
            <p className="rounded-md bg-rose-500/10 p-2.5 text-xs leading-relaxed text-rose-700 dark:text-rose-300">
              Jika Anda menutup layar itu tanpa menyimpan kuncinya, seluruh data yang dienkripsi
              dengan kunci tersebut <strong>hilang selamanya</strong>. Tidak ada pemulihan, tidak ada
              cadangan, tidak ada jalan pintas.
            </p>
            <p className="text-xs text-muted-foreground">
              Siapkan pengelola kata sandi atau brankas kredensial sebelum melanjutkan.
            </p>

            <label className="flex cursor-pointer items-start gap-2.5 rounded-md border p-3">
              <Checkbox
                checked={initAck}
                onCheckedChange={(value) => setInitAck(value === true)}
                className="mt-0.5"
              />
              <span className="text-sm leading-snug">
                Saya mengerti kunci ini tidak dapat ditampilkan ulang
              </span>
            </label>
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-9 text-xs"
              disabled={busy === 'init'}
              onClick={() => {
                setShowInitWarning(false);
                setInitAck(false);
              }}
            >
              Batal
            </Button>
            <Button
              type="button"
              className="h-9 gap-1.5 text-xs"
              disabled={!initAck || busy === 'init'}
              onClick={() => void handleInitialize()}
            >
              {busy === 'init' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <KeyRound className="h-3.5 w-3.5" />
              )}
              Buat Kunci Master
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── One-time key reveal ──────────────────────────────── */}
      <Dialog open={revealed !== null}>
        <DialogContent
          className="sm:max-w-lg"
          showCloseButton={false}
          // Every accidental dismissal path is closed off: an Esc keypress or a
          // stray click outside here destroys the only copy of the key.
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <KeyRound className="h-5 w-5 shrink-0 text-amber-500" />
              {revealed?.origin === 'rotate' ? 'Kunci master baru' : 'Kunci master Anda'}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Ini satu-satunya kesempatan untuk melihat kunci ini. Salin dan simpan sekarang.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <code className="block w-full rounded-md border bg-muted px-3 py-3 font-mono text-sm leading-relaxed break-all select-all">
              {revealed?.key}
            </code>

            <Button
              type="button"
              variant="outline"
              className="w-full gap-1.5"
              onClick={() => revealed && void handleCopy(revealed.key)}
            >
              {copied ? (
                <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              {copied ? 'Tersalin' : 'Salin kunci'}
            </Button>

            <p className="flex items-start gap-2 rounded-md bg-rose-500/10 p-2.5 text-xs leading-relaxed text-rose-700 dark:text-rose-300">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
              <span>
                Setelah dialog ini ditutup, kunci tidak dapat ditampilkan lagi.
                {revealed?.origin === 'rotate'
                  ? ' Kunci lama sudah tidak berlaku. Perbarui setiap catatan kunci yang Anda simpan.'
                  : ' Salinan ini adalah cadangan Anda bila berkas kunci di server hilang.'}
              </span>
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Kunci sudah ditulis ke berkas di server, jadi aplikasi berjalan normal tanpa Anda
              memasukkannya lagi. Simpan salinan ini di pengelola kata sandi atau brankas kredensial
              bersama — ia satu-satunya jalan pulih kalau server, volume, atau backup berkas kuncinya
              hilang.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" className="h-9 w-full gap-1.5 text-xs" onClick={dismissRevealed}>
              <Check className="h-3.5 w-3.5" />
              Saya sudah menyimpan kunci ini
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/** One sibling service: reachable at all, and whether it holds the key. */
function ServiceRow({
  service,
  appUnlocked,
}: {
  service: EncryptionStatus['services'][number];
  appUnlocked: boolean;
}) {
  // A service without the key falls back to its env vars, which usually still
  // "work" — so nothing fails and the divergence goes unnoticed unless it is
  // said out loud here.
  const degraded = appUnlocked && !service.unlocked;

  return (
    <li
      className={cn(
        'flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-2.5 py-2 text-xs',
        degraded && 'border-amber-500/20 bg-amber-500/5',
      )}
    >
      <span className="font-medium">{service.name}</span>

      {!service.reachable ? (
        <Badge className="border border-rose-500/20 bg-rose-500/10 text-[10px] text-rose-700 dark:text-rose-300">
          <WifiOff className="mr-1 h-3 w-3" />
          Tidak dapat dihubungi
        </Badge>
      ) : service.unlocked ? (
        <Badge className="border border-emerald-500/20 bg-emerald-500/10 text-[10px] text-emerald-700 dark:text-emerald-300">
          <ShieldCheck className="mr-1 h-3 w-3" />
          Memegang kunci
        </Badge>
      ) : (
        <Badge className="border border-rose-500/20 bg-rose-500/10 text-[10px] text-rose-700 dark:text-rose-300">
          <Lock className="mr-1 h-3 w-3" />
          Terkunci
        </Badge>
      )}

      {degraded && (
        <span className="w-full text-[11px] leading-snug text-amber-700 dark:text-amber-300">
          {service.reachable
            ? 'Layanan ini belum memegang kunci — pengaturan terenkripsinya akan jatuh kembali ke environment variable. Kunci lalu buka kembali enkripsi untuk mengirim ulang kunci.'
            : 'Layanan tidak dapat dihubungi, sehingga tidak menerima kunci — pengaturan terenkripsinya akan jatuh kembali ke environment variable. Setelah layanan hidup, buka kembali enkripsi agar kunci terkirim.'}
        </span>
      )}
    </li>
  );
}
