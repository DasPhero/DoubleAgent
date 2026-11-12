import { describe, it, expect } from 'vitest';
import { computeCvssV31, COMMON_MITRE_TECHNIQUES } from './EvidenceVaultModal';

describe('CVSS v3.1 Calculator & MITRE ATT&CK (F-18)', () => {
  it('correctly calculates CVSS v3.1 base score for unauthenticated critical network RCE', () => {
    // Standard Critical Network Exploit (e.g. Log4Shell / Remote Code Execution)
    const result = computeCvssV31({
      av: 'N',
      ac: 'L',
      pr: 'N',
      ui: 'N',
      s: 'U',
      c: 'H',
      i: 'H',
      a: 'H',
    });

    expect(result.score).toBe(9.8);
    expect(result.severity).toBe('critical');
    expect(result.vector).toBe('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H');
  });

  it('correctly calculates CVSS v3.1 for local privilege escalation (Unquoted Service Path)', () => {
    // Local, Low Privileges, Scope Unchanged, High Confidentiality/Integrity/Availability
    const result = computeCvssV31({
      av: 'L',
      ac: 'L',
      pr: 'L',
      ui: 'N',
      s: 'U',
      c: 'H',
      i: 'H',
      a: 'H',
    });

    expect(result.score).toBe(7.8);
    expect(result.severity).toBe('high');
    expect(result.vector).toBe('CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H');
  });

  it('correctly calculates CVSS v3.1 with Scope Changed (Sudo NOPASSWD / Container Breakout)', () => {
    // Scope Changed increases score multiplier
    const result = computeCvssV31({
      av: 'L',
      ac: 'L',
      pr: 'L',
      ui: 'N',
      s: 'C',
      c: 'H',
      i: 'H',
      a: 'H',
    });

    expect(result.score).toBe(8.8);
    expect(result.severity).toBe('high');
    expect(result.vector).toBe('CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:C/C:H/I:H/A:H');
  });

  it('provides comprehensive standard MITRE ATT&CK techniques presets', () => {
    expect(COMMON_MITRE_TECHNIQUES).toContain('T1003.001 - OS Credential Dumping: LSASS Memory');
    expect(COMMON_MITRE_TECHNIQUES).toContain('T1021.006 - Remote Services: Windows Remote Management (WinRM)');
    expect(COMMON_MITRE_TECHNIQUES).toContain('T1558.003 - Steal or Forge Kerberos Tickets: Kerberoasting');
    expect(COMMON_MITRE_TECHNIQUES).toContain('T1574.009 - Hijack Execution Flow: Path Interception by Unquoted Path');
  });
});
