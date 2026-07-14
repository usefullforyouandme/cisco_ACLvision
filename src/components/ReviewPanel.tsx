import { useMemo } from 'react';
import type { Device } from '../types/ir';
import {
  reviewDevice,
  CATEGORY_META,
  CATEGORY_ORDER,
  type Finding,
  type FindingCategory,
  type Severity,
} from '../analysis/review';
import { useApp } from '../state/AppContext';
import { buildMarkdownReport, reportFileName } from '../export/markdown';

/**
 * V4 レビュー支援。機械的に検出した指摘をカテゴリ別チェックリストで提示する(判断は人間が行う前提)。
 * Phase 2 対象: 過大許可 / 未使用 ACL / 未定義参照(ACL・object-group)/ 拒否ログ(基本設計 §4.2 V4)。
 */
/** Markdown 文字列をブラウザでダウンロードさせる(永続化はせず、その場で持ち出すだけ)。 */
function downloadMarkdown(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ReviewPanel({ device }: { device: Device }) {
  const { state, dispatch } = useApp();
  const findings = useMemo(() => reviewDevice(device), [device]);

  const exportReport = () => {
    const now = new Date();
    downloadMarkdown(reportFileName(now), buildMarkdownReport(state.devices, now));
  };

  const grouped = useMemo(() => {
    const map = new Map<FindingCategory, Finding[]>();
    for (const f of findings) {
      const list = map.get(f.category) ?? [];
      list.push(f);
      map.set(f.category, list);
    }
    return map;
  }, [findings]);

  if (!device.osSupported) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          この装置の OS は Phase 1 では未対応のため、レビュー支援を実行できません。
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-800">レビュー支援</h2>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500">
            指摘 {findings.length} 件(機械検出。最終判断はレビュー担当が行ってください)
          </span>
          <button
            onClick={exportReport}
            className="rounded border border-sky-300 bg-sky-50 px-3 py-1 text-sm font-medium text-sky-700 hover:bg-sky-100"
            title="読込済みの全装置の監査レポートを Markdown で書き出します"
          >
            Markdown レポート出力
          </button>
        </div>
      </div>

      {findings.length === 0 && (
        <div className="rounded border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-800">
          自動検出の対象となる指摘は見つかりませんでした。
        </div>
      )}

      {CATEGORY_ORDER.map((category) => {
        const items = grouped.get(category);
        if (!items || items.length === 0) return null;
        const meta = CATEGORY_META[category];
        return (
          <section key={category} className="rounded-md border border-slate-200 bg-white">
            <header className="flex items-baseline gap-2 border-b border-slate-100 px-4 py-2">
              <h3 className="font-semibold text-slate-800">{meta.label}</h3>
              <span className="rounded bg-slate-100 px-2 text-xs text-slate-600">{items.length}</span>
              <p className="text-xs text-slate-500">{meta.description}</p>
            </header>
            <ul className="divide-y divide-slate-100">
              {items.map((f, i) => (
                <FindingRow
                  key={`${category}-${i}`}
                  finding={f}
                  onJump={
                    f.sourceLineNo
                      ? () => dispatch({ type: 'JUMP_TO_LINE', lineNo: f.sourceLineNo! })
                      : undefined
                  }
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

const SEVERITY_STYLE: Record<Severity, { badge: string; label: string }> = {
  error: { badge: 'bg-red-100 text-red-800', label: '要対応' },
  warn: { badge: 'bg-amber-100 text-amber-800', label: '要確認' },
  info: { badge: 'bg-sky-100 text-sky-800', label: '参考' },
};

function FindingRow({ finding, onJump }: { finding: Finding; onJump?: () => void }) {
  const sev = SEVERITY_STYLE[finding.severity];
  return (
    <li
      className={`flex items-start gap-3 px-4 py-2 text-sm ${onJump ? 'cursor-pointer hover:bg-sky-50' : ''}`}
      onClick={onJump}
      title={onJump ? 'クリックで原文の該当行へ' : undefined}
    >
      <span className={`mt-0.5 rounded px-1.5 py-0.5 text-xs font-semibold ${sev.badge}`}>{sev.label}</span>
      <div className="min-w-0">
        <div className="font-mono text-slate-800">{finding.title}</div>
        <div className="text-xs text-slate-500">{finding.detail}</div>
      </div>
      {finding.sourceLineNo && (
        <span className="ml-auto whitespace-nowrap text-xs text-slate-400">L{finding.sourceLineNo}</span>
      )}
    </li>
  );
}
