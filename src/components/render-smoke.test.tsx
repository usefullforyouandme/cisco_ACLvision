import { describe, it, expect, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseConfig, resetDeviceSeq } from '../parser';
import { AppProvider } from '../state/AppContext';
import { ApplicationMap } from './ApplicationMap';
import { ReviewPanel } from './ReviewPanel';
import { DeviceSummary } from './DeviceSummary';
import { AclTable } from './AclTable';
import { ASA_SAMPLE } from '../parser/__tests__/fixtures/asa-sample';

// 実コンフィグを解析した Device で各ビューがクラッシュせず描画できることを確認する。
const CONFIG = `hostname R1
ip access-list extended EDGE-IN
 permit tcp any any eq 443
 permit ip any any
 permit tcp object-group MISSING-OG any eq 22
!
ip access-list extended UNUSED-ACL
 permit ip 10.0.0.0 0.0.0.255 any
!
interface Gi0/0
 ip address 203.0.113.1 255.255.255.0
 ip access-group EDGE-IN in
 ip access-group NOT-DEFINED out
!
line vty 0 4
 access-class UNUSED-ACL in
 transport input ssh`;

describe('ビュー描画スモーク', () => {
  beforeEach(() => resetDeviceSeq());

  const render = (node: React.ReactElement) =>
    renderToStaticMarkup(<AppProvider>{node}</AppProvider>);

  it('適用マップが SVG を描画する', () => {
    const d = parseConfig(CONFIG);
    const html = render(<ApplicationMap device={d} />);
    expect(html).toContain('<svg');
    expect(html).toContain('EDGE-IN');
    // 未定義参照 ACL がノードとして現れる
    expect(html).toContain('NOT-DEFINED');
  });

  it('レビューパネルが指摘を描画する', () => {
    const d = parseConfig(CONFIG);
    const html = render(<ReviewPanel device={d} />);
    expect(html).toContain('過大許可');
    expect(html).toContain('未定義参照');
  });

  it('サマリと ACL テーブルが描画できる', () => {
    const d = parseConfig(CONFIG);
    expect(render(<DeviceSummary device={d} />)).toContain('R1');
    expect(render(<AclTable device={d} />)).toContain('EDGE-IN');
  });

  it('ASA コンフィグでも全ビューが描画できる', () => {
    const d = parseConfig(ASA_SAMPLE, { forcedOs: 'asa' });
    expect(render(<DeviceSummary device={d} />)).toContain('FW1');
    expect(render(<AclTable device={d} />)).toContain('OUTSIDE-IN');
    expect(render(<ApplicationMap device={d} />)).toContain('<svg');
    // 展開トグルUI(object-group 展開)がレンダリングされる
    expect(render(<AclTable device={d} />)).toContain('object-group 展開');
  });
});
