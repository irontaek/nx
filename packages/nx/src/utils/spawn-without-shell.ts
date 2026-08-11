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
 * Spawn without a shell, routing Windows `.cmd` / `.bat` shims through
 * `cmd.exe` so they stay launchable. Use these wherever arguments carry
 * workspace configuration; a caller running a user-authored command string
 * wants a shell and should not.
 */
export function spawnWithoutShell(
  binary: string,
  args: readonly string[],
  options: Omit<SpawnOptions, 'shell'> = {}
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
  options: Omit<ExecFileOptions, 'shell'> = {}
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
  options: Omit<ExecFileSyncOptions, 'encoding' | 'shell'> = {}
): string {
  const target = resolveTarget(binary, args, options);
  return execFileSync(target.binary, target.args, {
    stdio: 'pipe',
    ...target.options,
    windowsHide: true,
    encoding: 'utf-8',
  });
}

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
 * A bare name like `mvn` is a `.cmd` shim on Windows, and without a shell only
 * the PATHEXT-resolved path is spawnable.
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

// Embedded quotes follow the MS C runtime backslash convention.
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
