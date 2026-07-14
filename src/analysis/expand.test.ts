import { describe, it, expect, beforeEach } from 'vitest';
import { parseConfig, resetDeviceSeq } from '../parser';
import { buildGroupIndex, expandNetworkGroup, expandServiceGroup } from './expand';
import { ASA_SAMPLE } from '../parser/__tests__/fixtures/asa-sample';

describe('object-group 展開', () => {
  beforeEach(() => resetDeviceSeq());

  it('ネットワークグループを再帰展開する(group-object のネスト)', () => {
    const d = parseConfig(ASA_SAMPLE);
    const index = buildGroupIndex(d);
    const res = expandNetworkGroup('BRANCH', index);
    expect(res.members).toEqual(['10.10.10.1', '10.10.20.0/24', '10.10.30.0/24']);
    expect(res.missing).toEqual([]);
    expect(res.cyclic).toBe(false);
  });

  it('サービスグループを展開する', () => {
    const d = parseConfig(ASA_SAMPLE);
    const index = buildGroupIndex(d);
    const res = expandServiceGroup('WEB-PORTS', index);
    expect(res.members).toEqual(['eq www', 'eq https']);
  });

  it('単一 object(ASA)を展開する', () => {
    const d = parseConfig(ASA_SAMPLE);
    const index = buildGroupIndex(d);
    expect(expandNetworkGroup('WEB-SRV', index).members).toEqual(['192.168.1.10']);
    expect(expandNetworkGroup('DMZ-NET', index).members).toEqual(['192.168.1.0/24']);
  });

  it('未定義グループは missing に記録する', () => {
    const d = parseConfig(ASA_SAMPLE);
    const index = buildGroupIndex(d);
    const res = expandNetworkGroup('NO-SUCH-GROUP', index);
    expect(res.members).toEqual([]);
    expect(res.missing).toContain('NO-SUCH-GROUP');
  });

  it('循環参照を検出して打ち切る', () => {
    const cfg = `object-group network A
 group-object B
object-group network B
 group-object A
 network-object host 10.0.0.9`;
    const d = parseConfig(cfg, { forcedOs: 'asa' });
    const index = buildGroupIndex(d);
    const res = expandNetworkGroup('A', index);
    expect(res.cyclic).toBe(true);
    expect(res.members).toContain('10.0.0.9');
  });

  it('IOS の network object-group(netmask 表記)も展開できる', () => {
    const cfg = `object-group network OG1
 host 10.10.10.1
 10.10.20.0 255.255.255.0`;
    const d = parseConfig(cfg, { forcedOs: 'ios' });
    const index = buildGroupIndex(d);
    const res = expandNetworkGroup('OG1', index);
    expect(res.members).toEqual(['10.10.10.1', '10.10.20.0/24']);
  });
});
