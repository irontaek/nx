import { SpawnOptions } from 'child_process';
import { extname } from 'path';

/**
 * Adapts a `spawn`/`execFile` invocation so it never needs `shell: true`.
 *
 * Node cannot execute `.cmd` / `.bat` shims directly, which is the usual reason
 * callers reach for `shell: true` — and that turns every argument into shell
 * source. This wraps such shims in `cmd.exe /d /s /c` with
 * `windowsVerbatimArguments` so quoting follows the cmd.exe convention rather
 * than Node's default cooking, letting callers pass args as an array.
 *
 * On non-Windows, or for binaries that are not shims, this is a passthrough.
 */
export function adaptSpawnForWindowsShim(
  binary: string,
  args: readonly string[],
  options: SpawnOptions
): { binary: string; args: string[]; options: SpawnOptions } {
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
 * PATHEXT-resolved path is spawnable. Returns the input unchanged when it
 * already has an extension or cannot be resolved.
 */
function resolveWindowsBinary(binary: string): string {
  if (extname(binary)) {
    return binary;
  }
  try {
    const which = require('which');
    return which.sync(binary, { nothrow: true }) ?? binary;
  } catch {
    return binary;
  }
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
