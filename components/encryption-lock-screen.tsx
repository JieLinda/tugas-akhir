'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, KeyRound, Loader2, Lock, Unlock } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { unlockEncryptionAction } from '@/lib/encryption-actions';

/**
 * Full-screen gate shown instead of the app while encryption is active but no
 * key is held. Rendered by the route-group layouts so nothing in the shell is
 * reachable in that state — no data can be read or written until the operator
 * pastes the master key, which doubles as the only credential this screen needs.
 */
export function EncryptionLockScreen({ keyFilePath }: { keyFilePath?: string | null }) {
  const router = useRouter();

  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUnlock() {
    const masterKey = key.trim();
    if (!masterKey) {
      setError('Masukkan kunci master terlebih dahulu.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await unlockEncryptionAction(masterKey, { bypassPermission: true });
      if (!result.success) {
        setError(result.message);
        toast.error('Gagal membuka enkripsi', { description: result.message });
        return;
      }
      setKey('');
      if (result.warnings.length > 0) {
        toast.warning('Kunci diterima, tetapi sebagian layanan pendamping tidak terbuka', {
          description: result.warnings.join(' '),
        });
      } else {
        toast.success('Enkripsi terbuka', {
          description: 'Aplikasi sudah dapat digunakan kembali.',
        });
      }
      // Re-run the layout: it now sees an unlocked key store and renders the app.
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(234,88,12,0.16),transparent_34%),linear-gradient(135deg,rgba(248,250,252,0.98),rgba(226,232,240,0.82))] p-4 dark:bg-[radial-gradient(circle_at_top_left,rgba(234,88,12,0.18),transparent_34%),linear-gradient(135deg,rgba(15,23,42,1),rgba(30,41,59,0.95))]">
      <Card className="w-full max-w-md border-primary/20 bg-card/92 shadow-[0_36px_90px_-48px_rgba(15,23,42,0.85)]">
        <CardHeader className="space-y-4 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-lg bg-rose-500/10 shadow-[0_18px_34px_-20px_rgba(225,29,72,0.9)]">
            <Lock className="h-8 w-8 text-rose-600 dark:text-rose-400" />
          </div>
          <div className="space-y-1.5">
            <CardTitle className="text-xl">Aplikasi terkunci</CardTitle>
            <CardDescription>
              Enkripsi data aktif, tetapi aplikasi tidak memegang kunci. Untuk melindungi data,
              seluruh aplikasi tidak dapat digunakan sampai kunci master dimasukkan.
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="lock-master-key" className="text-xs text-muted-foreground">
              Kunci master
            </Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="lock-master-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={key}
                placeholder="Tempel kunci master di sini"
                className="font-mono text-sm"
                autoFocus
                disabled={busy}
                onChange={(e) => {
                  setKey(e.target.value);
                  if (error) setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleUnlock();
                  }
                }}
                aria-invalid={error !== null}
              />
              <Button
                className="shrink-0 gap-1.5 sm:w-auto"
                disabled={busy}
                onClick={() => void handleUnlock()}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Unlock className="h-4 w-4" />
                )}
                Buka Kunci
              </Button>
            </div>
            {error && (
              <p className="flex items-start gap-2 rounded-md bg-rose-500/10 p-2.5 text-xs leading-snug text-rose-700 dark:text-rose-300">
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 break-words">{error}</span>
              </p>
            )}
          </div>

          <div className="rounded-md bg-sky-500/10 p-2.5 text-xs leading-relaxed text-sky-700 dark:text-sky-300">
            <p className="flex items-start gap-2">
              <KeyRound className="mt-px h-3.5 w-3.5 shrink-0" />
              <span>
                Masukkan kunci master yang disimpan saat enkripsi diaktifkan.
              </span>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
