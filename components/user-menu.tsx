"use client";

import { useSession } from "next-auth/react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Building2Icon, LogOut, Shield } from "lucide-react";
import { GitBranchIcon } from "@phosphor-icons/react";

export function UserMenu() {
  const { data: session } = useSession();

  if (!session?.user) return null;

  const initials = session.user.name
    ? session.user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .substring(0, 2)
        .toUpperCase()
    : "?";

  const isAdmin = (session.user as any)?.isAdmin || false;
  const divisionNames = (session.user as any)?.divisionNames || [];
  const departmentNames = (session.user as any)?.departmentNames || [];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 w-9 rounded-full p-0">
          <Avatar className="h-9 w-9">
            <AvatarFallback className="bg-primary/10 text-primary font-medium text-sm">
              {initials}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72" align="end">
        <div className="flex flex-col space-y-2 p-3">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium leading-none">
              {session.user.name || "User"}
            </p>
            {isAdmin && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                <Shield className="h-3 w-3" />
                Admin
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{session.user.email}</p>
          {divisionNames.length > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 text-xs font-medium">
              <Building2Icon className="size-3" />
              <span className="truncate max-w-[150px]">
                {divisionNames.join(", ")}
              </span>
            </span>
          )}
          {departmentNames.length > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-600 dark:text-cyan-400 text-xs font-medium">
              <GitBranchIcon className="size-3" />
              <span className="truncate max-w-[150px]">
                {departmentNames.join(", ")}
              </span>
            </span>
          )}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          // Full navigation (not next-auth's signOut) so the browser follows the
          // redirect chain into Keycloak's end_session_endpoint — that is what
          // actually ends the SSO session and lets a different user sign in.
          onClick={() => {
            window.location.href = `${
              process.env.NEXT_PUBLIC_BASE_PATH || ""
            }/api/auth/federated-logout`;
          }}
          className="text-destructive"
        >
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
