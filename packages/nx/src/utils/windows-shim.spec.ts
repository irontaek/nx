import { adaptSpawnForWindowsShim } from './windows-shim';

describe('adaptSpawnForWindowsShim', () => {
  const originalPlatform = process.platform;
  const originalComspec = process.env.comspec;

  function setPlatform(value: NodeJS.Platform): void {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      writable: true,
      value,
    });
  }

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      writable: true,
      value: originalPlatform,
    });
    if (originalComspec === undefined) delete process.env.comspec;
    else process.env.comspec = originalComspec;
  });

  it('returns inputs untouched for non-shim binaries on Windows', () => {
    setPlatform('win32');
    const out = adaptSpawnForWindowsShim('C:\\bin\\claude.exe', ['a'], {});
    expect(out.binary).toBe('C:\\bin\\claude.exe');
    expect(out.args).toEqual(['a']);
    expect(out.options.windowsVerbatimArguments).toBeUndefined();
  });

  it.each([
    ['lowercase .cmd', 'C:\\Program Files\\agent\\bin\\claude.cmd'],
    ['.bat', 'C:\\tools\\agent.bat'],
    ['uppercase .CMD', 'C:\\bin\\AGENT.CMD'],
  ])(
    'wraps %s in cmd.exe /d /s /c with windowsVerbatimArguments',
    (_label, binary) => {
      setPlatform('win32');
      process.env.comspec = 'C:\\Windows\\System32\\cmd.exe';
      const out = adaptSpawnForWindowsShim(binary, ['--flag', 'value'], {
        stdio: 'inherit',
        windowsHide: true,
      });
      expect(out.binary).toBe('C:\\Windows\\System32\\cmd.exe');
      expect(out.args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
      expect(out.args[3]).toMatch(/^".*"$/);
      expect(out.options.windowsVerbatimArguments).toBe(true);
      // Pre-existing options are preserved.
      expect(out.options.stdio).toBe('inherit');
      expect(out.options.windowsHide).toBe(true);
    }
  );

  it('quotes args and caret-escapes cmd metacharacters (cross-spawn style)', () => {
    setPlatform('win32');
    const out = adaptSpawnForWindowsShim(
      'C:\\bin\\claude.cmd',
      ['arg with spaces', 'arg&with&amp', 'plain'],
      {}
    );
    // Each arg is double-quoted, then cmd.exe metacharacters (including the
    // quotes and the embedded spaces) are caret-escaped — cmd strips the
    // carets in its first parsing pass, leaving the original argument intact.
    const cmdLine = out.args[3];
    expect(cmdLine).toContain('^"arg^ with^ spaces^"');
    expect(cmdLine).toContain('^"arg^&with^&amp^"');
    expect(cmdLine).toContain('^"plain^"');
  });

  it('falls back to "cmd.exe" when comspec is unset', () => {
    setPlatform('win32');
    delete process.env.comspec;
    const out = adaptSpawnForWindowsShim('C:\\x.cmd', [], {});
    expect(out.binary).toBe('cmd.exe');
  });
});
