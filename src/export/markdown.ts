import type { Acl, Device, ServiceSummary } from '../types/ir';
import { formatRule } from '../utils/format';
import {
  reviewDevice,
  countByCategory,
  CATEGORY_META,
  CATEGORY_ORDER,
  type Finding,
  type Severity,
} from '../analysis/review';

// Markdown 監査レポートの生成(基本設計 §5 / メモリの方針: エクスポートは Markdown 最優先)。
// 読込済みの全装置を 1 本の Markdown にまとめ、そのままレビュー報告書へ貼り込める粒度にする。
// 永続化はしないため、生成物はダウンロードでのみ持ち出す(呼び出し側の責務)。

const SEVERITY_LABEL: Record<Severity, string> = {
  error: '要対応',
  warn: '要確認',
  info: '参考',
};

/** Markdown の表セル用に `|` と改行をエスケープする。 */
function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/** ローカルタイムを "YYYY-MM-DD HH:mm" に整形する。 */
function formatTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

const OS_LABEL: Record<Device['os'], string> = {
  ios: 'Cisco IOS',
  asa: 'Cisco ASA',
};

/** 管理サービスの有効/無効を箇条書きにする。 */
function serviceLines(s: ServiceSummary): string[] {
  const yn = (v: boolean | undefined) => (v ? '有効' : '無効');
  const lines = [
    `- SSH: ${yn(s.ssh)}`,
    `- Telnet: ${yn(s.telnet)}`,
    `- HTTP サーバ: ${yn(s.httpServer)}`,
    `- HTTPS サーバ: ${yn(s.httpsServer)}`,
    `- SNMP: ${yn(s.snmp)}`,
  ];
  if (s.vtyAccessClass && s.vtyAccessClass.length > 0) {
    lines.push(`- vty access-class: ${s.vtyAccessClass.join(', ')}`);
  }
  return lines;
}

/** 1 つの ACL 定義をルール表として描画する。 */
function aclSection(acl: Acl): string[] {
  const out: string[] = [];
  out.push(`#### ${acl.name}(${acl.type}, ${acl.rules.length} ルール)`);
  out.push('');
  if (acl.rules.length === 0) {
    out.push('_ルールなし_');
    out.push('');
    return out;
  }
  out.push('| # | ルール | 行 |');
  out.push('| ---: | --- | ---: |');
  acl.rules.forEach((rule, i) => {
    out.push(`| ${i + 1} | \`${cell(formatRule(rule))}\` | ${rule.sourceLineNo} |`);
  });
  out.push('');
  return out;
}

/** レビュー指摘をカテゴリ別に描画する。 */
function findingsSection(findings: Finding[]): string[] {
  const out: string[] = [];
  out.push('### レビュー指摘');
  out.push('');
  if (findings.length === 0) {
    out.push('自動検出の対象となる指摘は見つかりませんでした。');
    out.push('');
    return out;
  }

  const counts = countByCategory(findings);
  out.push(`指摘 ${findings.length} 件(機械検出。最終判断はレビュー担当が行ってください)。`);
  out.push('');
  out.push('| カテゴリ | 件数 |');
  out.push('| --- | ---: |');
  for (const category of CATEGORY_ORDER) {
    if (counts[category] > 0) {
      out.push(`| ${CATEGORY_META[category].label} | ${counts[category]} |`);
    }
  }
  out.push('');

  const grouped = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = grouped.get(f.category) ?? [];
    list.push(f);
    grouped.set(f.category, list);
  }

  for (const category of CATEGORY_ORDER) {
    const items = grouped.get(category);
    if (!items || items.length === 0) continue;
    const meta = CATEGORY_META[category];
    out.push(`#### ${meta.label}(${items.length})`);
    out.push('');
    out.push(`> ${meta.description}`);
    out.push('');
    for (const f of items) {
      const loc = f.sourceLineNo ? ` (L${f.sourceLineNo})` : '';
      out.push(`- **[${SEVERITY_LABEL[f.severity]}]** ${f.title}${loc}`);
      out.push(`  - ${f.detail}`);
    }
    out.push('');
  }
  return out;
}

/** 1 装置分の Markdown を生成する。 */
function deviceSection(device: Device): string[] {
  const out: string[] = [];
  out.push(`## ${device.hostname}`);
  out.push('');

  // 基本情報。
  out.push('| 項目 | 値 |');
  out.push('| --- | --- |');
  out.push(`| ホスト名 | ${cell(device.hostname)} |`);
  out.push(`| OS | ${OS_LABEL[device.os]} |`);
  if (device.version) out.push(`| バージョン | ${cell(device.version)} |`);
  if (device.sourceName) out.push(`| 元ファイル | ${cell(device.sourceName)} |`);
  out.push(`| インターフェース | ${device.interfaces.length} |`);
  out.push(`| ACL 定義 | ${device.acls.length} |`);
  out.push(`| ACL 適用 | ${device.bindings.length} |`);
  out.push(`| object-group | ${device.objectGroups.length} |`);
  out.push(`| 未解析行 | ${device.unparsedLines.length} |`);
  out.push('');

  if (!device.osSupported) {
    out.push('> この装置の OS は未対応のため、解析・レビューは省略されています。');
    out.push('');
    return out;
  }

  // 管理サービス。
  out.push('### 管理サービス');
  out.push('');
  out.push(...serviceLines(device.services));
  out.push('');

  // ACL 適用状況。
  out.push('### ACL 適用状況');
  out.push('');
  if (device.bindings.length === 0) {
    out.push('適用されている ACL はありません。');
    out.push('');
  } else {
    out.push('| ACL | 適用先 | 方向 | 種別 | 行 |');
    out.push('| --- | --- | --- | --- | ---: |');
    for (const b of device.bindings) {
      out.push(
        `| ${cell(b.aclName)} | ${cell(b.target)} | ${b.direction ?? '-'} | ${b.kind} | ${b.sourceLineNo} |`,
      );
    }
    out.push('');
  }

  // レビュー指摘。
  out.push(...findingsSection(reviewDevice(device)));

  // ACL 定義(全ルール)。
  out.push('### ACL 定義');
  out.push('');
  if (device.acls.length === 0) {
    out.push('ACL 定義はありません。');
    out.push('');
  } else {
    for (const acl of device.acls) {
      out.push(...aclSection(acl));
    }
  }

  return out;
}

/**
 * 読込済みの全装置から監査レポート(Markdown)を生成する。
 * @param devices 対象装置。
 * @param now 生成日時(省略時は現在時刻。テストのため注入可能)。
 */
export function buildMarkdownReport(devices: Device[], now: Date = new Date()): string {
  const out: string[] = [];
  out.push('# ACLvision 監査レポート');
  out.push('');
  out.push(`- 生成日時: ${formatTimestamp(now)}`);
  out.push(`- 対象装置数: ${devices.length}`);
  out.push('');
  out.push(
    '> 本レポートの指摘は設定テキストから機械的に抽出したものです。' +
      '実際の通信要件・運用背景を踏まえた最終判断はレビュー担当者が行ってください。',
  );
  out.push('');

  if (devices.length === 0) {
    out.push('対象となる装置が読み込まれていません。');
    out.push('');
  }

  for (const device of devices) {
    out.push('---');
    out.push('');
    out.push(...deviceSection(device));
  }

  // 末尾は改行 1 つで終える。
  return out.join('\n').replace(/\n+$/, '\n');
}

/** レポートのダウンロード用ファイル名を生成する(aclvision-report-YYYYMMDD.md)。 */
export function reportFileName(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `aclvision-report-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.md`;
}
