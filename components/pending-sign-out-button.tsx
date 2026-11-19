'use client';

import { Button } from '@/components/ui/button';
import { LogOut, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';

/**
 * Actions on the pending page. Sign-out goes through the federated-logout route
 * so the Keycloak SSO session ends too — otherwise the user cannot switch to a
 * different account from here.
 */
export function PendingSignOutButton() {
  const router = useRouter();

  return (
    <div className="flex flex-col gap-2">
      <Button variant="outline" className="w-full" onClick={() => router.refresh()}>
        <RefreshCw className="mr-2 h-4 w-4" />
        Periksa lagi
      </Button>
      <Button
        variant="ghost"
        className="w-full text-destructive hover:text-destructive"
        onClick={() => {
          window.location.href = `${
            process.env.NEXT_PUBLIC_BASE_PATH || ''
          }/api/auth/federated-logout`;
        }}
      >
        <LogOut className="mr-2 h-4 w-4" />
        Keluar
      </Button>
    </div>
  );
}
