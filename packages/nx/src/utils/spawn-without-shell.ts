import {
  ChildProcess,
  execFile,
  ExecFileOptions,
  execFileSync,
  ExecFileSyncOptions,
  spawn,
  SpawnOptions,
} from 'child_process';
import { extname } from 'path';

/**
 * Spawn a process without a shell.
 *
 * Prefer these over calling `child_process` directly whenever the arguments
 * carry workspace configuration: a shell would make those values executable.
 * Callers that genuinely need shell semantics — running a user-authored
 * command string — should not use these.
 *
 * Node cannot execute `.cmd` / `.bat` shims directly, which is the usual reason
 * callers reach for `shell: true`; these route such shims through
 * `cmd.exe /d /s /c` with escaped, verbatim arguments instead.
 */
export function spawnWithoutShell(
  binary: string,
  args: readonly string[],
  options: SpawnOptions = {}
): ChildProcess {
  const target = resolveTarget(binary, args, options);
  return spawn(target.binary, target.args, {
    ...target.options,
    windowsHide: true,
  });
}

export function execFileWithoutShell(
  binary: string,
  args: readonly string[],
  options: ExecFileOptions = {}
): ChildProcess {
  const target = resolveTarget(binary, args, options);
  return execFile(
    target.binary,
    target.args,
    { ...target.options, windowsHide: true },
    undefined
  );
}

export function execFileSyncWithoutShell(
  binary: string,
  args: readonly string[],
  options: Omit<ExecFileSyncOptions, 'encoding'> = {}
): string {
  const target = resolveTarget(binary, args, options);
  return execFileSync(target.binary, target.args, {
    stdio: 'pipe',
    ...target.options,
    windowsHide: true,
    encoding: 'utf-8',
  });
}

/**
 * Rewrites a call so it is spawnable without a shell. On non-Windows, and for
 * binaries that are not `.cmd` / `.bat`, this only resolves the binary.
 */
function resolveTarget<T extends object>(
  binary: string,
  args: readonly string[],
  options: T
): { binary: string; args: string[]; options: T } {
  if (process.platform !== 'win32') {
    return { binary, args: [...args], options };
  }

  const resolved = resolveWindowsBinary(binary);
  const ext = extname(resolved).toLowerCase();
  if (ext !== '.cmd' && ext !== '.bat') {
    return { binary: resolved, args: [...args], options };
  }

  const cmdLine = [escapeCmdCommand(resolved), ...args.map(escapeCmdArg)].join(
    ' '
  );
  return {
    binary: process.env.comspec || 'cmd.exe',
    // Outer pair of quotes is required so cmd.exe /c does not strip the inner
    // quotes around the binary path.
    args: ['/d', '/s', '/c', `"${cmdLine}"`],
    options: { ...options, windowsVerbatimArguments: true },
  };
}

/**
 * A bare name like `mvn` is a `.cmd` shim on Windows; without a shell only the
 * PATHEXT-resolved path is spawnable (`which` handles PATHEXT). Returns the
 * input unchanged when it is already a path, already has an extension, or is
 * not found on PATH.
 */
function resolveWindowsBinary(binary: string): string {
  if (extname(binary) || binary.includes('/') || binary.includes('\\')) {
    return binary;
  }
  // Required lazily so non-Windows graph construction never loads it.
  const which = require('which');
  return which.sync(binary, { nothrow: true }) ?? binary;
}

const CMD_META_CHARS = /([()\][%!^"`<>&|;, ])/g;

// Backslash-escape embedded quotes per MS C runtime convention, wrap in
// quotes, then caret-escape cmd.exe metacharacters.
function escapeCmdArg(arg: string): string {
  const quoted = `"${arg
    .replace(/(\\*)"/g, '$1$1\\"')
    .replace(/(\\*)$/, '$1$1')}"`;
  return quoted.replace(CMD_META_CHARS, '^$1');
}

function escapeCmdCommand(arg: string): string {
  // cmd.exe interprets the command portion through an extra parsing pass;
  // apply the caret-escape twice so the .cmd shim sees the original.
  return escapeCmdArg(arg).replace(CMD_META_CHARS, '^$1');
}
