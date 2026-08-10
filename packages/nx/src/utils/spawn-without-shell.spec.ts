import { spawn } from 'child_process';
import which from 'which';
import { spawnWithoutShell } from './spawn-without-shell';

jest.mock('child_process', () => ({ spawn: jest.fn() }));
jest.mock('which', () => ({ sync: jest.fn() }));

describe('spawnWithoutShell', () => {
  const originalPlatform = process.platform;
  const originalComspec = process.env.comspec;

  function setPlatform(value: NodeJS.Platform): void {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      writable: true,
      value,
    });
  }

  function spawnArgs() {
    return (spawn as unknown as jest.Mock).mock.calls[0];
  }

  beforeEach(() => {
    (spawn as unknown as jest.Mock).mockReset();
    (which.sync as jest.Mock).mockReset();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      writable: true,
      value: originalPlatform,
    });
    if (originalComspec === undefined) delete process.env.comspec;
    else process.env.comspec = originalComspec;
  });

  it('never passes a shell, and always sets windowsHide', () => {
    setPlatform('linux');

    spawnWithoutShell('./mvnw', ['-DtargetNamePrefix=a; touch /tmp/pwned'], {
      cwd: '/ws',
    });

    const [binary, args, options] = spawnArgs();
    expect(binary).toBe('./mvnw');
    expect(args).toEqual(['-DtargetNamePrefix=a; touch /tmp/pwned']);
    expect(options.shell).toBeUndefined();
    expect(options.windowsHide).toBe(true);
  });

  it('passes non-shim binaries straight through on Windows', () => {
    setPlatform('win32');

    spawnWithoutShell('C:\\bin\\docker.exe', ['ps'], {});

    const [binary, args, options] = spawnArgs();
    expect(binary).toBe('C:\\bin\\docker.exe');
    expect(args).toEqual(['ps']);
    expect(options.windowsVerbatimArguments).toBeUndefined();
  });

  it.each([
    ['lowercase .cmd', 'C:\\Program Files\\agent\\bin\\claude.cmd'],
    ['.bat', 'C:\\tools\\agent.bat'],
    ['uppercase .CMD', 'C:\\bin\\AGENT.CMD'],
  ])('wraps %s in cmd.exe /d /s /c', (_label, binary) => {
    setPlatform('win32');
    process.env.comspec = 'C:\\Windows\\System32\\cmd.exe';

    spawnWithoutShell(binary, ['--flag', 'value'], { stdio: 'inherit' });

    const [spawned, args, options] = spawnArgs();
    expect(spawned).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
    expect(args[3]).toMatch(/^".*"$/);
    expect(options.windowsVerbatimArguments).toBe(true);
    expect(options.stdio).toBe('inherit');
  });

  it('quotes args and caret-escapes cmd metacharacters', () => {
    setPlatform('win32');

    spawnWithoutShell(
      'C:\\bin\\claude.cmd',
      ['arg with spaces', 'arg&with&amp', 'plain'],
      {}
    );

    const cmdLine = spawnArgs()[1][3];
    expect(cmdLine).toContain('^"arg^ with^ spaces^"');
    expect(cmdLine).toContain('^"arg^&with^&amp^"');
    expect(cmdLine).toContain('^"plain^"');
  });

  it('falls back to "cmd.exe" when comspec is unset', () => {
    setPlatform('win32');
    delete process.env.comspec;

    spawnWithoutShell('C:\\x.cmd', [], {});

    expect(spawnArgs()[0]).toBe('cmd.exe');
  });

  describe('bare-name resolution', () => {
    // `mvn` on Windows is really mvn.cmd; without a shell only the resolved
    // path is spawnable.
    it('resolves a bare name through which and wraps the .cmd it finds', () => {
      setPlatform('win32');
      (which.sync as jest.Mock).mockReturnValue('C:\\maven\\bin\\mvn.cmd');

      spawnWithoutShell('mvn', ['-v'], {});

      expect(which.sync).toHaveBeenCalledWith('mvn', { nothrow: true });
      expect(spawnArgs()[0]).toMatch(/cmd\.exe$/i);
      expect(spawnArgs()[1][3]).toContain('mvn.cmd');
    });

    it('leaves a bare name alone when nothing on PATH matches', () => {
      setPlatform('win32');
      (which.sync as jest.Mock).mockReturnValue(null);

      spawnWithoutShell('mvn', ['-v'], {});

      expect(spawnArgs()[0]).toBe('mvn');
      expect(spawnArgs()[2].windowsVerbatimArguments).toBeUndefined();
    });

    it('does not probe PATH for a relative path like ./mvnw', () => {
      setPlatform('win32');

      spawnWithoutShell('./mvnw', ['-v'], {});

      expect(which.sync).not.toHaveBeenCalled();
      expect(spawnArgs()[0]).toBe('./mvnw');
    });
  });
});
