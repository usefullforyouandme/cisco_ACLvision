import { describe, it, expect, beforeEach } from 'vitest';
import { parseConfig, resetDeviceSeq } from '../index';
import { IOS_SAMPLE } from './fixtures/ios-sample';

describe('IOS パーサ', () => {
  beforeEach(() => resetDeviceSeq());

  it('ホスト名・バージョン・OS を取得する', () => {
    const d = parseConfig(IOS_SAMPLE);
    expect(d.os).toBe('ios');
    expect(d.osSupported).toBe(true);
    expect(d.hostname).toBe('RT01');
    expect(d.version).toBe('15.2');
  });

  it('named extended ACL のルールを順序どおり解析する', () => {
    const d = parseConfig(IOS_SAMPLE);
    const acl = d.acls.find((a) => a.name === 'OUTSIDE-IN');
    expect(acl).toBeDefined();
    expect(acl!.type).toBe('extended');
    expect(acl!.rules).toHaveLength(3);

    const [r10, r20, r30] = acl!.rules;
    expect(r10!.seq).toBe(10);
    expect(r10!.action).toBe('permit');
    expect(r10!.protocol).toBe('tcp');
    expect(r10!.src).toEqual({ kind: 'subnet', addr: '10.0.0.0', wildcard: '0.0.0.255' });
    expect(r10!.dst).toEqual({ kind: 'host', ip: '192.168.1.10' });
    expect(r10!.dstPort).toEqual({ op: 'eq', port: '443' });
    expect(r10!.options.log).toBe(true);
    // 直前の remark がルールに紐付く
    expect(r10!.remark).toEqual(['allow web to DMZ']);

    // object-group 参照は展開せず保持
    expect(r20!.src).toEqual({ kind: 'objectGroup', name: 'BRANCH-NET' });

    // permit ip any any / deny ip any any
    expect(r30!.action).toBe('deny');
    expect(r30!.src).toEqual({ kind: 'any' });
    expect(r30!.dst).toEqual({ kind: 'any' });
  });

  it('named standard ACL を解析する(dst は any 固定)', () => {
    const d = parseConfig(IOS_SAMPLE);
    const acl = d.acls.find((a) => a.name === 'MGMT');
    expect(acl!.type).toBe('standard');
    expect(acl!.rules[0]!.src).toEqual({ kind: 'host', ip: '10.9.9.9' });
    expect(acl!.rules[1]!.src).toEqual({ kind: 'subnet', addr: '10.9.0.0', wildcard: '0.0.255.255' });
    expect(acl!.rules[0]!.dst).toEqual({ kind: 'any' });
  });

  it('numbered ACL を番号帯から種別判定して集約する', () => {
    const d = parseConfig(IOS_SAMPLE);
    const acl10 = d.acls.find((a) => a.name === '10');
    expect(acl10!.type).toBe('standard');
    expect(acl10!.number).toBe(10);
    expect(acl10!.rules).toHaveLength(2);
    expect(acl10!.rules[1]!.src).toEqual({ kind: 'any' });

    const acl100 = d.acls.find((a) => a.name === '100');
    expect(acl100!.type).toBe('extended');
    expect(acl100!.rules[0]!.dstPort).toEqual({ op: 'eq', port: '80' });
  });

  it('インターフェースと ACL 適用を解析する', () => {
    const d = parseConfig(IOS_SAMPLE);
    const g0 = d.interfaces.find((i) => i.name === 'GigabitEthernet0/0');
    expect(g0!.ip).toBe('203.0.113.1 255.255.255.0');
    expect(g0!.description).toBe('uplink');
    expect(g0!.shutdown).toBe(false);
    expect(g0!.aclBindings).toHaveLength(1);
    expect(g0!.aclBindings[0]).toMatchObject({ aclName: 'OUTSIDE-IN', direction: 'in', kind: 'interface' });

    const g1 = d.interfaces.find((i) => i.name === 'GigabitEthernet0/1');
    expect(g1!.shutdown).toBe(true);

    const vlan = d.interfaces.find((i) => i.name === 'Vlan10');
    expect(vlan!.vlan).toBe('10');
  });

  it('line vty / snmp / http のサービスと binding を解析する', () => {
    const d = parseConfig(IOS_SAMPLE);
    expect(d.services.ssh).toBe(true);
    expect(d.services.snmp).toBe(true);
    expect(d.services.httpServer).toBe(true);
    expect(d.services.vtyAccessClass).toContain('MGMT');

    const lineBinding = d.bindings.find((b) => b.kind === 'line');
    expect(lineBinding).toMatchObject({ aclName: 'MGMT', direction: 'in' });
    const snmpBinding = d.bindings.find((b) => b.kind === 'snmp');
    expect(snmpBinding).toMatchObject({ aclName: '10' });
  });

  it('object-group を保持する(展開はしない)', () => {
    const d = parseConfig(IOS_SAMPLE);
    const og = d.objectGroups.find((g) => g.name === 'BRANCH-NET');
    expect(og!.type).toBe('network');
    expect(og!.lines).toEqual(['host 10.10.10.1', '10.10.20.0 255.255.255.0']);
  });

  it('未解析行を原文保持する(全体を落とさない)', () => {
    const d = parseConfig(IOS_SAMPLE);
    const unparsed = d.unparsedLines.find((u) => u.text.includes('this-is-an-unknown-command'));
    expect(unparsed).toBeDefined();
  });

  it('ACL 部分のみの抜粋でも動作する', () => {
    const excerpt = `ip access-list extended SNIP
 permit tcp any any eq 443
 deny ip any any`;
    const d = parseConfig(excerpt);
    expect(d.acls).toHaveLength(1);
    expect(d.acls[0]!.rules).toHaveLength(2);
  });
});
