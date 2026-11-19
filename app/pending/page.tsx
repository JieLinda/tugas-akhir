import { redirect } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getCurrentUser } from '@/lib/auth';
import { getCurrentUserAccess, recordUserLogin } from '@/lib/rbac';
import { PendingSignOutButton } from '@/components/pending-sign-out-button';
import { Hourglass } from 'lucide-react';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Menunggu Akses | PULSE',
  description: 'Akun Anda belum memiliki peran.',
};

/**
 * Holding page for authenticated users who have not been assigned a role yet.
 * Deliberately outside the (dashboard) route group so it renders without the
 * sidebar — a pending user must not see the app shell at all.
 */
export default async function PendingPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/signin');

  // Make sure the account exists in User Management so an admin can find it and
  // grant a role — this page is often the very first thing a new user reaches.
  await recordUserLogin(user);

  // Already has a role? Nothing to wait for.
  const access = await getCurrentUserAccess();
  if (access && !access.isPending) redirect('/');

  return (
    <div className="min-h-screen flex items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(234,88,12,0.16),transparent_34%),linear-gradient(135deg,rgba(248,250,252,0.98),rgba(226,232,240,0.82))] p-4 dark:bg-[radial-gradient(circle_at_top_left,rgba(234,88,12,0.18),transparent_34%),linear-gradient(135deg,rgba(15,23,42,1),rgba(30,41,59,0.95))]">
      <Card className="w-full max-w-md border-primary/20 bg-card/92 shadow-[0_36px_90px_-48px_rgba(15,23,42,0.85)]">
        <CardHeader className="text-center space-y-4">
          <div className="mx-auto w-16 h-16 rounded-lg bg-primary/10 flex items-center justify-center shadow-[0_18px_34px_-20px_rgba(234,88,12,0.9)]">
            <Hourglass className="w-8 h-8 text-primary" />
          </div>
          <div className="space-y-1.5">
            <CardTitle className="text-xl">Menunggu penetapan peran</CardTitle>
            <CardDescription>
              Akun Anda sudah terdaftar, tetapi belum diberi peran sehingga belum dapat mengakses
              PULSE.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm">
            <p className="font-medium text-foreground">{user.name || 'Pengguna'}</p>
            <p className="text-xs text-muted-foreground">{user.email}</p>
          </div>

          <p className="text-sm text-muted-foreground leading-relaxed">
            Silakan hubungi administrator untuk meminta akses. Setelah peran diberikan, muat ulang
            halaman ini untuk masuk.
          </p>

          <PendingSignOutButton />
        </CardContent>
      </Card>
    </div>
  );
}
