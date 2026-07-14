import { describe, it, expect } from 'vitest';
import {
  ipToInt,
  intToIp,
  wildcardToMask,
  maskToPrefix,
  wildcardToPrefix,
  matchesWildcard,
  formatSubnet,
} from './ip';

describe('IP ユーティリティ', () => {
  it('ipToInt / intToIp が往復する', () => {
    expect(ipToInt('255.255.255.255')).toBe(0xffffffff);
    expect(ipToInt('0.0.0.0')).toBe(0);
    expect(intToIp(ipToInt('10.1.2.3')!)).toBe('10.1.2.3');
  });

  it('不正な IP は null', () => {
    expect(ipToInt('256.0.0.1')).toBeNull();
    expect(ipToInt('10.0.0')).toBeNull();
    expect(ipToInt('abc')).toBeNull();
  });

  it('ワイルドカードをマスク/prefix に変換する', () => {
    expect(wildcardToMask('0.0.0.255')).toBe('255.255.255.0');
    expect(wildcardToPrefix('0.0.0.255')).toBe(24);
    expect(wildcardToPrefix('0.0.255.255')).toBe(16);
    expect(maskToPrefix('255.255.255.0')).toBe(24);
  });

  it('不連続ワイルドカードは prefix にできない', () => {
    expect(wildcardToPrefix('0.0.255.0')).toBeNull();
  });

  it('matchesWildcard がサブネット包含を判定する', () => {
    expect(matchesWildcard('10.0.0.5', '10.0.0.0', '0.0.0.255')).toBe(true);
    expect(matchesWildcard('10.0.1.5', '10.0.0.0', '0.0.0.255')).toBe(false);
    expect(matchesWildcard('10.0.1.5', '10.0.0.0', '0.0.255.255')).toBe(true);
  });

  it('formatSubnet が CIDR 整形する', () => {
    expect(formatSubnet('10.0.0.0', '0.0.0.255')).toBe('10.0.0.0/24');
    expect(formatSubnet('1.2.3.4', '0.0.0.0')).toBe('1.2.3.4');
    // 不連続ワイルドカードは原文表現のまま
    expect(formatSubnet('10.0.0.0', '0.0.255.0')).toBe('10.0.0.0 0.0.255.0');
  });
});
