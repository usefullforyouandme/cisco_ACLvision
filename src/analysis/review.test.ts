import { describe, it, expect, beforeEach } from 'vitest';
import { parseConfig, resetDeviceSeq } from '../parser';
import { reviewDevice, countByCategory } from './review';

describe('レビュー分析(V4)', () => {
  beforeEach(() => resetDeviceSeq());

  const config = `hostname R1
ip access-list extended EDGE-IN
 permit tcp any any eq 443
 permit ip any any
 permit tcp object-group MISSING-OG any eq 22
!
ip access-list extended UNUSED-ACL
 permit ip 10.0.0.0 0.0.0.255 any
!
object-group network KNOWN-OG
 host 10.0.0.1
!
interface Gi0/0
 ip access-group EDGE-IN in
 ip access-group NOT-DEFINED out
`;

  it('過大許可(permit ip any any)を検出する', () => {
    const d = parseConfig(config);
    const findings = reviewDevice(d);
    const overly = findings.filter((f) => f.category === 'overly-permissive');
    expect(overly).toHaveLength(1);
    expect(overly[0]!.aclName).toBe('EDGE-IN');
    expect(overly[0]!.sourceLineNo).toBeGreaterThan(0);
  });

  it('port が any でない permit tcp any any eq 443 は過大許可としない', () => {
    const d = parseConfig(config);
    const overly = reviewDevice(d).filter((f) => f.category === 'overly-permissive');
    expect(overly.every((f) => !f.title.includes('443'))).toBe(true);
  });

  it('未定義 ACL 参照を error で検出する', () => {
    const d = parseConfig(config);
    const undef = reviewDevice(d).filter((f) => f.category === 'undefined-acl');
    expect(undef).toHaveLength(1);
    expect(undef[0]!.title).toBe('NOT-DEFINED');
    expect(undef[0]!.severity).toBe('error');
  });

  it('未定義 object-group 参照を検出する', () => {
    const d = parseConfig(config);
    const undef = reviewDevice(d).filter((f) => f.category === 'undefined-object-group');
    expect(undef).toHaveLength(1);
    expect(undef[0]!.title).toBe('MISSING-OG');
  });

  it('未使用 ACL を検出する', () => {
    const d = parseConfig(config);
    const unused = reviewDevice(d).filter((f) => f.category === 'unused-acl');
    expect(unused.map((f) => f.title)).toContain('UNUSED-ACL');
  });

  it('拒否ログのない適用中 ACL を info で指摘する', () => {
    const d = parseConfig(config);
    const denyLog = reviewDevice(d).filter((f) => f.category === 'deny-log');
    // EDGE-IN は deny+log を持たないので指摘される。UNUSED-ACL は未適用なので対象外。
    expect(denyLog.map((f) => f.title)).toContain('EDGE-IN');
    expect(denyLog.map((f) => f.title)).not.toContain('UNUSED-ACL');
  });

  it('countByCategory が件数を集計する', () => {
    const d = parseConfig(config);
    const counts = countByCategory(reviewDevice(d));
    expect(counts['undefined-acl']).toBe(1);
    expect(counts['overly-permissive']).toBe(1);
  });
});
