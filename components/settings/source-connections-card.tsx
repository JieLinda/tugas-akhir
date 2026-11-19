'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Info,
  KeyRound,
  Loader2,
  Lock,
  PlugZap,
  RefreshCw,
  Save,
  WifiOff,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/datetime';

import { CollapsibleCard } from '@/components/settings/collapsible-card';
import {
  getSourceConnectionsAction,
  saveSourceConnectionAction,
  testSourceConnectionAction,
  type SourceConnectionView,
  type SourceConnectionsState,
} from '@/lib/sync-connection-actions';

type SourceKey = SourceConnectionView['sourceKey'];

/** Port is held as a string so the field can be transiently empty while typing. */
type FormState = {
  server: string;
  port: string;
  username: string;
  password: string;
  databaseName: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
  isActive: boolean;
};

const SOURCE_META: Record<SourceKey, { label: string; desc: string }> = {
  MPMDS: {
    label: 'DB MPMDS',
    desc: 'Master karyawan, master jabatan, hierarki, dan kompetensi teknis.',
  },
  MPMHRGA: {
    label: 'DB MPMHRGA',
    desc: 'Penilaian kinerja, grade level, dan kompetensi perilaku.',
  },
};

/** The password is never round-tripped, so the form field always starts empty. */
function toForm(view: SourceConnectionView): FormState {
  return {
    server: view.server,
    port: String(view.port),
    username: view.username,
    password: '',
    databaseName: view.databaseName,
    encrypt: view.encrypt,
    trustServerCertificate: view.trustServerCertificate,
    isActive: view.isActive,
  };
}

function isDirty(form: FormState, view: SourceConnectionView): boolean {
  return (
    form.server !== view.server ||
    form.port !== String(view.port) ||
    form.username !== view.username ||
    form.password !== '' ||
    form.databaseName !== view.databaseName ||
    form.encrypt !== view.encrypt ||
    form.trustServerCertificate !== view.trustServerCertificate ||
    form.isActive !== view.isActive
  );
}

export function SourceConnectionsCard({ className }: { className?: string }) {
  const [state, setState] = useState<SourceConnectionsState | null>(null);
  const [forms, setForms] = useState<Record<string, FormState>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<SourceKey | null>(null);
  const [testingKey, setTestingKey] = useState<SourceKey | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, { success: boolean; message: string }>
  >({});

  /**
   * `resetKeys` is narrowed to the just-saved connection after a save: refetching
   * is needed so the effective panel reflects the new settings, but blindly
   * re-seeding every form would throw away unsaved edits typed into the OTHER
   * connection while this one was being saved.
   */
  const load = useCallback(async (resetKeys?: SourceKey[]) => {
    try {
      const next = await getSourceConnectionsAction();
      setState(next);
      setForms((prev) => {
        const merged = { ...prev };
        for (const conn of next.connections) {
          if (!resetKeys || resetKeys.includes(conn.sourceKey)) {
            merged[conn.sourceKey] = toForm(conn);
          }
        }
        return merged;
      });
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load().finally(() => setLoading(false));
  }, [load]);

  const patch = (key: SourceKey, changes: Partial<FormState>) => {
    setForms((prev) => ({ ...prev, [key]: { ...prev[key]!, ...changes } }));
  };

  async function handleSave(view: SourceConnectionView) {
    const form = forms[view.sourceKey];
    if (!form) return;

    const port = Number.parseInt(form.port, 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      toast.error('Port tidak valid', { description: 'Port harus antara 1 dan 65535.' });
      return;
    }

    setSavingKey(view.sourceKey);
    try {
      const res = await saveSourceConnectionAction({
        sourceKey: view.sourceKey,
        server: form.server,
        port,
        username: form.username,
        password: form.password,
        databaseName: form.databaseName,
        encrypt: form.encrypt,
        trustServerCertificate: form.trustServerCertificate,
        isActive: form.isActive,
      });
      if (!res.success) {
        toast.error(`Gagal menyimpan ${SOURCE_META[view.sourceKey].label}`, {
          description: res.message,
        });
        return;
      }
      toast.success(`${SOURCE_META[view.sourceKey].label} disimpan`, { description: res.message });
      // A stale test result now describes settings that no longer exist.
      setTestResults((prev) => {
        const next = { ...prev };
        delete next[view.sourceKey];
        return next;
      });
      await load([view.sourceKey]);
    } catch (e) {
      toast.error(`Gagal menyimpan ${SOURCE_META[view.sourceKey].label}`, {
        description: (e as Error).message,
      });
    } finally {
      setSavingKey(null);
    }
  }

  async function handleTest(key: SourceKey) {
    setTestingKey(key);
    try {
      const res = await testSourceConnectionAction(key);
      setTestResults((prev) => ({ ...prev, [key]: res }));
      if (res.success) {
        toast.success(`Koneksi ${SOURCE_META[key].label} berhasil`, { description: res.message });
      } else {
        toast.error(`Koneksi ${SOURCE_META[key].label} gagal`, { description: res.message });
      }
    } catch (e) {
      const message = (e as Error).message;
      setTestResults((prev) => ({ ...prev, [key]: { success: false, message } }));
      toast.error(`Koneksi ${SOURCE_META[key].label} gagal`, { description: message });
    } finally {
      setTestingKey(null);
    }
  }

  return (
    <CollapsibleCard
      className={className}
      defaultOpen={false}
      storageKey="sync:connections"
      accent="caution"
      title={
        <>
          <Database className="h-4 w-4 text-primary" />
          Koneksi Source Database
        </>
      }
      description="Pengaturan Database SQL Server yang dipakai layanan sinkronisasi. Bila belum diisi atau dinonaktifkan, layanan tetap memakai environment variable seperti sebelumnya."
      headerExtra={
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 gap-1.5"
          disabled={loading || savingKey !== null}
          onClick={() => {
            setLoading(true);
            void load().finally(() => setLoading(false));
          }}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          Muat ulang
        </Button>
      }
    >
      {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Memuat koneksi…
          </div>
        ) : loadError ? (
          <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-xs">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
            <div className="min-w-0">
              <p className="font-semibold text-rose-700 dark:text-rose-300">
                Gagal memuat pengaturan koneksi
              </p>
              <p className="mt-0.5 break-words text-muted-foreground">{loadError}</p>
            </div>
          </div>
        ) : state ? (
          <>
            {!state.encryptionUnlocked && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-relaxed">
                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="min-w-0">
                  <p className="font-semibold text-amber-700 dark:text-amber-300">
                    Enkripsi terkunci — password tidak dapat diubah
                  </p>
                  <p className="mt-0.5 text-muted-foreground">
                    Password baru harus dienkripsi, dan kuncinya belum dibuka. Buka kunci enkripsi di
                    Tata Kelola bila perlu mengganti password. Kolom lain tetap dapat disimpan seperti
                    biasa.
                  </p>
                </div>
              </div>
            )}

            {state.effective === null && (
              <div className="flex items-start gap-2 rounded-lg border border-sky-500/20 bg-sky-500/5 p-3 text-xs leading-relaxed">
                <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" />
                <div className="min-w-0">
                  <p className="font-semibold text-sky-800 dark:text-sky-200">
                    Layanan sinkronisasi tidak dapat dihubungi
                  </p>
                  <p className="mt-0.5 text-muted-foreground">
                    Nilai di bawah adalah yang tersimpan di database — belum tentu yang sedang dipakai
                    layanan. Pengaturan yang benar-benar aktif baru terlihat setelah layanan dapat
                    dihubungi kembali.
                  </p>
                </div>
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              {state.connections.map((view) => {
                const form = forms[view.sourceKey];
                if (!form) return null;
                return (
                  <ConnectionPanel
                    key={view.sourceKey}
                    view={view}
                    form={form}
                    effective={state.effective?.[view.sourceKey] ?? null}
                    serviceReachable={state.effective !== null}
                    encryptionUnlocked={state.encryptionUnlocked}
                    saving={savingKey === view.sourceKey}
                    testing={testingKey === view.sourceKey}
                    busy={savingKey !== null || testingKey !== null}
                    testResult={testResults[view.sourceKey] ?? null}
                    onChange={(changes) => patch(view.sourceKey, changes)}
                    onReset={() => patch(view.sourceKey, toForm(view))}
                    onSave={() => void handleSave(view)}
                    onTest={() => void handleTest(view.sourceKey)}
                  />
                );
              })}
            </div>
          </>
        ) : null}
    </CollapsibleCard>
  );
}

type EffectiveConnection = NonNullable<SourceConnectionsState['effective']>[SourceKey];

function ConnectionPanel({
  view,
  form,
  effective,
  serviceReachable,
  encryptionUnlocked,
  saving,
  testing,
  busy,
  testResult,
  onChange,
  onReset,
  onSave,
  onTest,
}: {
  view: SourceConnectionView;
  form: FormState;
  effective: EffectiveConnection | null;
  serviceReachable: boolean;
  encryptionUnlocked: boolean;
  saving: boolean;
  testing: boolean;
  /** Any connection is mid-save/mid-test — both write to the same service. */
  busy: boolean;
  testResult: { success: boolean; message: string } | null;
  onChange: (changes: Partial<FormState>) => void;
  onReset: () => void;
  onSave: () => void;
  onTest: () => void;
}) {
  const meta = SOURCE_META[view.sourceKey];
  const dirty = isDirty(form, view);
  const id = (field: string) => `${view.sourceKey}-${field}`;

  return (
    <div className="flex flex-col rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 shrink-0 text-primary" />
            <span className="truncate text-sm font-semibold">{meta.label}</span>
            <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
              {view.sourceKey}
            </Badge>
          </div>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{meta.desc}</p>
        </div>
        {dirty && (
          <Badge
            variant="outline"
            className="shrink-0 border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-300"
          >
            Belum disimpan
          </Badge>
        )}
      </div>

      <Separator className="my-3" />

      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div className="grid gap-1.5">
          <Label htmlFor={id('server')}>
            Server <span className="text-destructive">*</span>
          </Label>
          <Input
            id={id('server')}
            value={form.server}
            placeholder="10.0.0.10 atau sqlsrv.mpm.local"
            className="font-mono"
            onChange={(e) => onChange({ server: e.target.value })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={id('port')}>
            Port <span className="text-destructive">*</span>
          </Label>
          <Input
            id={id('port')}
            type="number"
            min={1}
            max={65535}
            value={form.port}
            placeholder="1433"
            className="w-full font-mono sm:w-24"
            onChange={(e) => onChange({ port: e.target.value })}
          />
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor={id('database')}>
            Nama database <span className="text-destructive">*</span>
          </Label>
          <Input
            id={id('database')}
            value={form.databaseName}
            placeholder="MPMDS"
            className="font-mono"
            onChange={(e) => onChange({ databaseName: e.target.value })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={id('username')}>
            Username <span className="text-destructive">*</span>
          </Label>
          <Input
            id={id('username')}
            value={form.username}
            placeholder="sa"
            className="font-mono"
            autoComplete="off"
            onChange={(e) => onChange({ username: e.target.value })}
          />
        </div>
      </div>

      {/* Write-only: the server never sends the password back, so an empty field
          means "keep what is stored" — never a masked stand-in for a real value. */}
      <div className="mt-3 grid gap-1.5">
        <Label htmlFor={id('password')} className="flex items-center gap-1.5">
          <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
          Password
        </Label>
        <Input
          id={id('password')}
          type="password"
          value={form.password}
          disabled={!encryptionUnlocked}
          autoComplete="new-password"
          placeholder={
            encryptionUnlocked
              ? 'Biarkan kosong untuk mempertahankan password tersimpan'
              : 'Enkripsi terkunci — password tidak dapat diubah'
          }
          onChange={(e) => onChange({ password: e.target.value })}
        />
        <p className="text-[11px] leading-snug text-muted-foreground">
          {view.hasPassword
            ? 'Ada password tersimpan (terenkripsi) dan tidak pernah ditampilkan kembali. Isi kolom ini hanya bila ingin menggantinya.'
            : 'Belum ada password tersimpan — layanan memakai password dari environment variable. Isi kolom ini untuk menyimpan password sendiri.'}
        </p>
        {!encryptionUnlocked && (
          <p className="flex items-start gap-1.5 text-[11px] leading-snug text-amber-700 dark:text-amber-300">
            <Lock className="mt-px h-3 w-3 shrink-0" />
            <span>Buka kunci enkripsi di Tata Kelola untuk mengubah password.</span>
          </p>
        )}
      </div>

      <div className="mt-3 space-y-2 rounded-md border bg-muted/30 p-2.5">
        <ToggleRow
          id={id('isActive')}
          label="Pakai pengaturan ini"
          hint="Bila dimatikan, layanan kembali memakai environment variable (DB_… ) untuk sumber ini."
          checked={form.isActive}
          onChange={(v) => onChange({ isActive: v })}
        />
        <ToggleRow
          id={id('encrypt')}
          label="Enkripsi koneksi (TLS)"
          hint="Mengaktifkan enkripsi TLS antara layanan dan MSSQL."
          checked={form.encrypt}
          onChange={(v) => onChange({ encrypt: v })}
        />
        <ToggleRow
          id={id('trust')}
          label="Percayai sertifikat server"
          hint="Perlu diaktifkan bila MSSQL memakai sertifikat self-signed."
          checked={form.trustServerCertificate}
          onChange={(v) => onChange({ trustServerCertificate: v })}
        />
      </div>

      <EffectivePanel effective={effective} serviceReachable={serviceReachable} />

      {view.updatedAt && (
        <p className="mt-2 text-[10px] text-muted-foreground">
          Terakhir disimpan {formatDateTime(view.updatedAt)}
        </p>
      )}

      {testResult && (
        <p
          className={cn(
            'mt-2 flex items-start gap-1.5 rounded-md p-1.5 text-[11px] leading-snug',
            testResult.success
              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
          )}
        >
          {testResult.success ? (
            <CheckCircle2 className="mt-px h-3 w-3 shrink-0" />
          ) : (
            <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
          )}
          <span className="min-w-0 break-words">{testResult.message}</span>
        </p>
      )}

      <div className="mt-auto pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" className="gap-1.5" disabled={saving || busy} onClick={onSave}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Simpan
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={testing || busy}
            onClick={onTest}
          >
            {testing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <PlugZap className="h-3.5 w-3.5" />
            )}
            Test Koneksi
          </Button>
          {dirty && (
            <Button variant="ghost" size="sm" disabled={saving || busy} onClick={onReset}>
              Batalkan perubahan
            </Button>
          )}
        </div>
        {/* The test hits the SAVED row on the service, so without this the operator
            reads a green result as validation of what is still only typed. */}
        <p
          className={cn(
            'mt-1.5 flex items-start gap-1.5 text-[10px] leading-snug',
            dirty ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground',
          )}
        >
          <Info className="mt-px h-3 w-3 shrink-0" />
          <span>
            {dirty
              ? 'Ada perubahan yang belum disimpan. Test Koneksi menguji pengaturan tersimpan, bukan yang diketik — simpan dulu, lalu uji.'
              : 'Test Koneksi menguji pengaturan yang tersimpan, bukan yang diketik di form. Simpan dulu, lalu uji.'}
          </span>
        </p>
      </div>
    </div>
  );
}

function ToggleRow({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-xs font-medium">
          {label}
        </Label>
        <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} className="mt-0.5 shrink-0" />
    </div>
  );
}

/**
 * What the service says it actually resolved, which can differ from the row
 * above: an inactive/absent row leaves it on env vars, and a locked key makes it
 * fall back to the env PASSWORD alone while using the stored server/database.
 */
function EffectivePanel({
  effective,
  serviceReachable,
}: {
  effective: EffectiveConnection | null;
  serviceReachable: boolean;
}) {
  if (!serviceReachable || !effective) {
    return (
      <p className="mt-3 flex items-start gap-1.5 rounded-md border border-dashed p-2 text-[10px] leading-snug text-muted-foreground">
        <WifiOff className="mt-px h-3 w-3 shrink-0" />
        <span>
          Pengaturan aktif tidak diketahui — layanan sinkronisasi tidak dapat dihubungi.
        </span>
      </p>
    );
  }

  const usingEnv = effective.origin === 'env';

  return (
    <div className="mt-3 rounded-md border p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Sedang dipakai layanan
        </span>
        {usingEnv ? (
          <Badge
            variant="outline"
            className="shrink-0 border-sky-500/40 bg-sky-500/10 text-[10px] text-sky-700 dark:text-sky-300"
          >
            <Info className="mr-1 h-3 w-3" />
            Environment variable
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="shrink-0 border-emerald-500/40 bg-emerald-500/10 text-[10px] text-emerald-700 dark:text-emerald-300"
          >
            <CheckCircle2 className="mr-1 h-3 w-3" />
            Pengaturan tersimpan
          </Badge>
        )}
      </div>

      <p className="mt-1.5 break-all font-mono text-[11px]">
        {effective.server || '—'}:{effective.port}/{effective.database || '—'}
      </p>
      <p className="mt-0.5 text-[10px] text-muted-foreground">
        Password: {effective.hasPassword ? 'terpasang' : 'kosong'} · origin:{' '}
        <span className="font-mono">{effective.origin}</span>
      </p>

      {usingEnv && (
        <p className="mt-1.5 text-[10px] leading-snug text-sky-700 dark:text-sky-300">
          Layanan masih berjalan di environment variable — pengaturan di atas belum tersimpan atau
          sedang dinonaktifkan.
        </p>
      )}

      {effective.passwordFellBackToEnv && (
        <p className="mt-2 flex items-start gap-1.5 rounded-md bg-amber-500/10 p-1.5 text-[11px] leading-snug text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
          <span className="min-w-0">
            <strong className="font-semibold">Password tersimpan tidak terpakai.</strong> Layanan
            tidak dapat mendekripsinya karena enkripsi terkunci, lalu diam-diam memakai password dari
            environment variable. Buka kunci enkripsi di Tata Kelola agar password tersimpan
            benar-benar dipakai.
          </span>
        </p>
      )}
    </div>
  );
}
