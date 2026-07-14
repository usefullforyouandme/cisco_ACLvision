import { describe, it, expect } from 'vitest';
import { detectOs } from '../detectOs';

describe('OS 判定', () => {
  it('IOS の named ACL 構文を IOS と判定する', () => {
    const text = `hostname R1
ip access-list extended FOO
 permit ip any any
interface Gi0/0
 ip access-group FOO in`;
    expect(detectOs(text)).toBe('ios');
  });

  it('ASA Version 行を ASA と判定する', () => {
    const text = `ASA Version 9.8
hostname FW1
access-list OUT extended permit tcp any any eq 443
access-group OUT in interface outside`;
    expect(detectOs(text)).toBe('asa');
  });

  it('numbered ACL のみでも IOS と判定する', () => {
    const text = `access-list 100 permit tcp any any eq 80
access-list 100 deny ip any any`;
    expect(detectOs(text)).toBe('ios');
  });
});
