/**
 * Cross-platform network-share access for the file-based syncs
 * (job profiles, kamus, HAV, MCU).
 *
 * - Windows: shared folders are reached via UNC paths (\\server\share\...) and
 *   may need credentials attached with `net use`.
 * - Linux/macOS: the share is mounted by the OS (CIFS / fstab / autofs) and
 *   reached through a normal POSIX path (e.g. /mnt/share/...). There is nothing
 *   to connect, and the Windows-only `net` binary does not exist — invoking it
 *   crashes with `spawn net ENOENT`.
 *
 * All platform branching for share access lives here so every sync behaves the
 * same. On non-Windows this module is effectively a no-op: point the sync's
 * folder env var at the mounted path and it just works.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { config } from "../config.js";

const execFileAsync = promisify(execFile);

const isWindows = process.platform === "win32";

/** Extract `\\server\share` from a UNC path, or null if it isn't one. */
function getUncShareRoot(folderPath: string): string | null {
  if (!folderPath.startsWith("\\\\")) {
    return null;
  }

  const parts = folderPath
    .replace(/^\\+/, "")
    .split("\\")
    .filter(Boolean);

  if (parts.length < 2) {
    return null;
  }

  return `\\\\${parts[0]}\\${parts[1]}`;
}

async function runNetUse(args: string[]): Promise<string> {
  try {
    const result = await execFileAsync("net", ["use", ...args], {
      windowsHide: true,
    });
    return `${result.stdout ?? ""}${result.stderr ?? ""}`;
  } catch (error) {
    const execError = error as Error & {
      stdout?: string;
      stderr?: string;
    };
    const details = [execError.message, execError.stdout, execError.stderr]
      .filter(Boolean)
      .join("\n")
      .trim();
    throw new Error(details || "Failed to run 'net use'");
  }
}

/**
 * Attach credentials to a Windows UNC share if needed and return a disconnect
 * callback. A no-op (returns an empty disconnect) when:
 *  - not on Windows (the OS mounts the share; POSIX path used directly), or
 *  - the path isn't a UNC path, or
 *  - no share credentials are configured.
 */
export async function ensureNetworkShareAccess(
  folderPath: string,
): Promise<() => Promise<void>> {
  if (!isWindows) {
    return async () => {};
  }

  const shareRoot = getUncShareRoot(folderPath);
  if (!shareRoot) {
    return async () => {};
  }

  const { localPdfUsername, localPdfPassword, localPdfDomain } = config;
  if (!localPdfUsername && !localPdfPassword) {
    return async () => {};
  }

  if (!localPdfUsername || !localPdfPassword) {
    throw new Error(
      "LOCAL_PDF_USERNAME and LOCAL_PDF_PASSWORD must both be set for credentialed network shares",
    );
  }

  const qualifiedUser = localPdfDomain
    ? `${localPdfDomain}\\${localPdfUsername}`
    : localPdfUsername;

  try {
    const currentConnection = await runNetUse([shareRoot]);
    if (!/There are no entries in the list/i.test(currentConnection)) {
      return async () => {};
    }
  } catch {
    // Ignore lookup failures and try to connect below.
  }

  await runNetUse([
    shareRoot,
    localPdfPassword,
    `/user:${qualifiedUser}`,
    "/persistent:no",
  ]);

  return async () => {
    try {
      await runNetUse([shareRoot, "/delete", "/y"]);
    } catch {
      // Best-effort cleanup only.
    }
  };
}

/**
 * Throw a clear, actionable error if a configured sync path is missing, instead
 * of letting a raw ENOENT surface deep in a read. On Linux this almost always
 * means the CIFS share isn't mounted at the configured path yet.
 */
export function assertPathAccessible(targetPath: string, envVarName: string): void {
  if (existsSync(targetPath)) {
    return;
  }

  const hint = isWindows
    ? "Check the UNC path and, for credentialed shares, that LOCAL_PDF_USERNAME/LOCAL_PDF_PASSWORD are set."
    : `On Linux this should be a mounted path (e.g. /mnt/...). Make sure the CIFS/SMB share is mounted before syncing.`;

  throw new Error(
    `Path from ${envVarName} is not accessible: "${targetPath}". ${hint}`,
  );
}
