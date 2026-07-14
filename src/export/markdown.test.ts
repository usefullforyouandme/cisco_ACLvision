import { describe, it, expect, beforeEach } from 'vitest';
import { parseConfig, resetDeviceSeq } from '../parser';
import { buildMarkdownReport, reportFileName } from './markdown';

describe('Markdown 監査レポート(Phase 4)', () => {
  beforeEach(() => resetDeviceSeq());

  const config = `hostname R1
ip access-list extended EDGE-IN
 deny ip 10.0.0.0 0.0.0.255 any
 permit tcp host 10.0.0.5 any eq 80
 permit ip any any
interface Gi0/0
 ip access-group EDGE-IN in
`;

  const fixedNow = new Date(2026, 6, 14, 9, 30); // 2026-07-14 09:30

  it('ヘッダと生成日時・装置数を含む', () => {
    const md = buildMarkdownReport([parseConfig(config)], fixedNow);
    expect(md).toContain('# ACLvision 監査レポート');
    expect(md).toContain('生成日時: 2026-07-14 09:30');
    expect(md).toContain('対象装置数: 1');
  });

  it('装置の見出しと ACL ルール表を含む', () => {
    const md = buildMarkdownReport([parseConfig(config)], fixedNow);
    expect(md).toContain('## R1');
    expect(md).toContain('### ACL 定義');
    expect(md).toContain('permit tcp 10.0.0.5 any eq 80');
  });

  it('レビュー指摘(過大許可・シャドウ等)をレポートに反映する', () => {
    const md = buildMarkdownReport([parseConfig(config)], fixedNow);
    expect(md).toContain('### レビュー指摘');
    expect(md).toContain('過大許可');
  });

  it('装置未読込でも例外なく生成できる', () => {
    const md = buildMarkdownReport([], fixedNow);
    expect(md).toContain('対象装置数: 0');
    expect(md).toContain('対象となる装置が読み込まれていません');
  });

  it('複数装置を区切り線で連結する', () => {
    resetDeviceSeq();
    const d1 = parseConfig(config);
    const d2 = parseConfig(`hostname R2\nip access-list standard AL\n permit any\n`);
    const md = buildMarkdownReport([d1, d2], fixedNow);
    expect(md).toContain('## R1');
    expect(md).toContain('## R2');
    expect(md).toContain('対象装置数: 2');
  });

  it('reportFileName が日付入りのファイル名を返す', () => {
    expect(reportFileName(fixedNow)).toBe('aclvision-report-20260714.md');
  });
});
