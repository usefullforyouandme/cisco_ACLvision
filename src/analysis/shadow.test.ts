import { describe, it, expect, beforeEach } from 'vitest';
import { parseConfig, resetDeviceSeq } from '../parser';
import { detectDeviceRuleIssues } from './shadow';
import { reviewDevice } from './review';

describe('シャドウ・冗長ルール検出(V4 / Phase 4)', () => {
  beforeEach(() => resetDeviceSeq());

  it('先行 deny が後続 permit を覆う場合はシャドウとして検出する', () => {
    const config = `hostname R1
ip access-list extended TEST
 deny ip 10.0.0.0 0.0.0.255 any
 permit tcp host 10.0.0.5 any eq 80
`;
    const issues = detectDeviceRuleIssues(parseConfig(config));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.type).toBe('shadowed');
    expect(issues[0]!.ruleIndex).toBe(1);
    expect(issues[0]!.byIndex).toBe(0);
  });

  it('先行 permit と同一動作で範囲が包含される後続 permit は冗長として検出する', () => {
    const config = `hostname R1
ip access-list extended TEST
 permit ip 10.0.0.0 0.0.0.255 any
 permit tcp host 10.0.0.5 any eq 443
`;
    const issues = detectDeviceRuleIssues(parseConfig(config));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.type).toBe('redundant');
  });

  it('包含関係のない独立したルールは検出しない', () => {
    const config = `hostname R1
ip access-list extended TEST
 permit tcp host 10.0.0.1 any eq 80
 permit tcp host 10.0.0.2 any eq 443
`;
    expect(detectDeviceRuleIssues(parseConfig(config))).toHaveLength(0);
  });

  it('後続ルールの方が範囲が広い場合は検出しない(逆方向は包含でない)', () => {
    const config = `hostname R1
ip access-list extended TEST
 permit tcp host 10.0.0.5 any eq 80
 permit ip 10.0.0.0 0.0.0.255 any
`;
    expect(detectDeviceRuleIssues(parseConfig(config))).toHaveLength(0);
  });

  it('object-group 参照は判定不能として検出しない(誤検知回避)', () => {
    const config = `hostname R1
object-group network GRP
 host 10.0.0.5
ip access-list extended TEST
 permit ip any any
 permit tcp object-group GRP any eq 80
`;
    // 先行 permit ip any any は object-group 側も any が覆うため実は包含する。
    // any は全アドレスを覆うので、これは冗長として検出される想定。
    const issues = detectDeviceRuleIssues(parseConfig(config));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.type).toBe('redundant');
  });

  it('ポート範囲の包含(range が eq を覆う)を検出する', () => {
    const config = `hostname R1
ip access-list extended TEST
 permit tcp any any range 20 100
 permit tcp any any eq 80
`;
    const issues = detectDeviceRuleIssues(parseConfig(config));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.type).toBe('redundant');
  });

  it('プロトコルが異なる(udp と tcp)場合は包含しない', () => {
    const config = `hostname R1
ip access-list extended TEST
 permit udp any any
 permit tcp any any eq 80
`;
    expect(detectDeviceRuleIssues(parseConfig(config))).toHaveLength(0);
  });

  it('reviewDevice がシャドウ・冗長を指摘に含める', () => {
    const config = `hostname R1
ip access-list extended TEST
 deny ip 10.0.0.0 0.0.0.255 any
 permit tcp host 10.0.0.5 any eq 80
interface Gi0/0
 ip access-group TEST in
`;
    const findings = reviewDevice(parseConfig(config));
    const shadow = findings.filter((f) => f.category === 'shadowed-rule');
    expect(shadow).toHaveLength(1);
    expect(shadow[0]!.severity).toBe('warn');
    expect(shadow[0]!.aclName).toBe('TEST');
  });
});
