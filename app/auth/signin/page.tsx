'use client';

import { signIn } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { KeyRound, Loader2 } from 'lucide-react';
import { useState } from 'react';

export default function SignInPage() {
  const [isLoading, setIsLoading] = useState(false);

  const handleSignIn = async () => {
    setIsLoading(true);
    try {
      await signIn('keycloak', {
        redirect: true,
        redirectTo: `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/`,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(234,88,12,0.16),transparent_34%),linear-gradient(135deg,rgba(248,250,252,0.98),rgba(226,232,240,0.82))] p-4 dark:bg-[radial-gradient(circle_at_top_left,rgba(234,88,12,0.18),transparent_34%),linear-gradient(135deg,rgba(15,23,42,1),rgba(30,41,59,0.95))]">
      <Card className="w-full max-w-md border-primary/20 bg-card/92 shadow-[0_36px_90px_-48px_rgba(15,23,42,0.85)]">
        <CardHeader className="text-center space-y-4">
          <div className="mx-auto w-16 h-16 rounded-lg bg-primary/10 flex items-center justify-center shadow-[0_18px_34px_-20px_rgba(234,88,12,0.9)]">
            <KeyRound className="w-8 h-8 text-primary" />
          </div>
          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.24em] text-primary/75">Secure Access</p>
            <CardTitle className="text-2xl font-bold">Welcome to PULSE</CardTitle>
            <CardDescription className="mt-2">
              Sign in with your organization account to access successor selection platform
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Button
            className="w-full h-12 text-base font-medium"
            onClick={handleSignIn}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Signing in...
              </>
            ) : (
              <>
                <KeyRound className="mr-2 h-5 w-5" />
                Sign in with Keycloak
              </>
            )}
          </Button>
          <p className="mt-4 text-center text-xs text-muted-foreground">
            By signing in, you agree to our Terms of Service and Privacy Policy
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
