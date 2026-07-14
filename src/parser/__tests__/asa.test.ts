import { describe, it, expect, beforeEach } from 'vitest';
import { parseConfig, resetDeviceSeq } from '../index';
import { detectOs } from '../detectOs';
import { ASA_SAMPLE } from './fixtures/asa-sample';

describe('ASA パーサ', () => {
  beforeEach(() => resetDeviceSeq());

  it('ASA と判定しバージョン・ホスト名を取得する', () => {
    expect(detectOs(ASA_SAMPLE)).toBe('asa');
    const d = parseConfig(ASA_SAMPLE);
    expect(d.os).toBe('asa');
    expect(d.osSupported).toBe(true);
    expect(d.hostname).toBe('FW1');
    expect(d.version).toBe('9.8(2)');
  });

  it('interface の nameif と IP を解析する', () => {
    const d = parseConfig(ASA_SAMPLE);
    const outside = d.interfaces.find((i) => i.nameif === 'outside');
    expect(outside).toBeDefined();
    expect(outside!.ip).toBe('203.0.113.1 255.255.255.0');
  });

  it('extended ACE を解析する(netmask→ワイルドカード、object参照、remark紐付け)', () => {
    const d = parseConfig(ASA_SAMPLE);
    const acl = d.acls.find((a) => a.name === 'OUTSIDE-IN');
    expect(acl).toBeDefined();
    expect(acl!.type).toBe('extended');
    expect(acl!.rules).toHaveLength(3);

    const [r1, r2, r3] = acl!.rules;
    // permit tcp any object WEB-SRV eq https
    expect(r1!.action).toBe('permit');
    expect(r1!.protocol).toBe('tcp');
    expect(r1!.src).toEqual({ kind: 'any' });
    expect(r1!.dst).toEqual({ kind: 'objectGroup', name: 'WEB-SRV' });
    expect(r1!.dstPort).toEqual({ op: 'eq', port: 'https' });
    expect(r1!.remark).toEqual(['allow web to server']);

    // permit tcp object-group BRANCH any object-group WEB-PORTS
    expect(r2!.src).toEqual({ kind: 'objectGroup', name: 'BRANCH' });
    expect(r2!.dstPort).toEqual({ op: 'objectGroup', name: 'WEB-PORTS' });

    // deny ip any any log
    expect(r3!.action).toBe('deny');
    expect(r3!.options.log).toBe(true);
  });

  it('access-group を nameif で interface に紐付ける', () => {
    const d = parseConfig(ASA_SAMPLE);
    const binding = d.bindings.find((b) => b.aclName === 'OUTSIDE-IN');
    expect(binding).toMatchObject({ kind: 'interface', target: 'outside', direction: 'in' });
    const outside = d.interfaces.find((i) => i.nameif === 'outside');
    expect(outside!.aclBindings).toHaveLength(1);
  });

  it('object / object-group を保持する', () => {
    const d = parseConfig(ASA_SAMPLE);
    const webSrv = d.objectGroups.find((g) => g.name === 'WEB-SRV');
    expect(webSrv!.isObject).toBe(true);
    expect(webSrv!.lines).toContain('host 192.168.1.10');

    const branch = d.objectGroups.find((g) => g.name === 'BRANCH');
    expect(branch!.isObject).toBeFalsy();
    expect(branch!.lines).toContain('group-object BRANCH-CHILD');
  });

  it('サービスを俯瞰する', () => {
    const d = parseConfig(ASA_SAMPLE);
    expect(d.services.ssh).toBe(true);
    expect(d.services.httpServer).toBe(true);
  });
});
