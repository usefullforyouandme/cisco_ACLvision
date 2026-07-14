import type { AclRule, Device } from '../types/ir';
import { analyzeReferences, isOverlyPermissive } from './references';
import { detectDeviceRuleIssues } from './shadow';
import { formatRule } from '../utils/format';

/** レビュー指摘の重要度。error=設定不備の疑い / warn=要確認 / info=参考。 */
export type Severity = 'error' | 'warn' | 'info';

export type FindingCategory =
  | 'overly-permissive'
  | 'shadowed-rule'
  | 'redundant-rule'
  | 'unused-acl'
  | 'undefined-acl'
  | 'undefined-object-group'
  | 'deny-log';

/** 機械的に検出できるレビュー指摘の 1 件(判断は人間が行う前提。基本設計 §4.2 V4)。 */
export interface Finding {
  category: FindingCategory;
  severity: Severity;
  /** 指摘の見出し(対象名など)。 */
  title: string;
  /** 補足説明。 */
  detail: string;
  /** 関連する ACL 名(あれば)。 */
  aclName?: string;
  /** クリックでジャンプする原文行(あれば)。 */
  sourceLineNo?: number;
}

export interface CategoryMeta {
  label: string;
  description: string;
}

/** カテゴリの表示メタ情報(パネルの見出しに使う)。 */
export const CATEGORY_META: Record<FindingCategory, CategoryMeta> = {
  'overly-permissive': {
    label: '過大許可',
    description: 'src / dst / port がすべて any の permit ルール。許可範囲が広すぎないか要確認。',
  },
  'shadowed-rule': {
    label: 'シャドウルール',
    description: '先行ルールに全体を覆われ、動作も異なるため評価されないデッドルール。設定意図と食い違っていないか要確認。',
  },
  'redundant-rule': {
    label: '冗長ルール',
    description: '先行ルールと同じ動作で範囲が包含されるルール。削除しても挙動は変わらない。',
  },
  'undefined-acl': {
    label: '未定義参照(ACL)',
    description: '適用されているが定義が存在しない ACL。タイプミスや定義漏れの疑い。',
  },
  'undefined-object-group': {
    label: '未定義参照(object-group)',
    description: 'ルールから参照されているが定義が存在しない object-group。',
  },
  'unused-acl': {
    label: '未使用 ACL',
    description: '定義されているがどこにも適用されていない ACL。削除漏れや適用忘れの可能性。',
  },
  'deny-log': {
    label: '拒否ログ',
    description: '拒否トラフィックのログ設定がない ACL。末尾の暗黙 deny で落ちる通信は記録されない。',
  },
};

/** カテゴリの表示順(重要度が高い順)。 */
export const CATEGORY_ORDER: FindingCategory[] = [
  'undefined-acl',
  'undefined-object-group',
  'overly-permissive',
  'shadowed-rule',
  'unused-acl',
  'redundant-rule',
  'deny-log',
];

/** ルールが参照している object-group 名(src/dst/port)を列挙する。 */
function referencedObjectGroups(rule: AclRule): string[] {
  const names: string[] = [];
  if (rule.src.kind === 'objectGroup') names.push(rule.src.name);
  if (rule.dst.kind === 'objectGroup') names.push(rule.dst.name);
  if (rule.srcPort?.op === 'objectGroup') names.push(rule.srcPort.name);
  if (rule.dstPort?.op === 'objectGroup') names.push(rule.dstPort.name);
  return names;
}

/**
 * 装置に対する V4 レビュー指摘を集約する。
 * 対象: 過大許可 / シャドウ・冗長ルール / 未使用 ACL / 未定義参照(ACL・object-group)/ 拒否ログ。
 */
export function reviewDevice(device: Device): Finding[] {
  const findings: Finding[] = [];
  const { unusedAcls, undefinedAcls } = analyzeReferences(device);
  const definedGroups = new Set(device.objectGroups.map((g) => g.name));

  // 未定義参照(ACL): どこから適用されているかも示す。
  for (const name of undefinedAcls) {
    const binding = device.bindings.find((b) => b.aclName === name);
    findings.push({
      category: 'undefined-acl',
      severity: 'error',
      title: name,
      detail: binding
        ? `${binding.target}${binding.direction ? `(${binding.direction})` : ''} に適用されているが定義がありません。`
        : '適用されているが定義がありません。',
      aclName: name,
      sourceLineNo: binding?.sourceLineNo,
    });
  }

  // 過大許可・未定義 object-group 参照は各ルールを走査。
  for (const acl of device.acls) {
    for (const rule of acl.rules) {
      if (isOverlyPermissive(rule)) {
        findings.push({
          category: 'overly-permissive',
          severity: 'warn',
          title: `${acl.name}: ${rule.action} ${rule.protocol} any any`,
          detail: 'すべての送信元・宛先・ポートを許可しています。',
          aclName: acl.name,
          sourceLineNo: rule.sourceLineNo,
        });
      }
      for (const groupName of referencedObjectGroups(rule)) {
        if (!definedGroups.has(groupName)) {
          findings.push({
            category: 'undefined-object-group',
            severity: 'error',
            title: groupName,
            detail: `ACL ${acl.name} から参照されていますが object-group の定義がありません。`,
            aclName: acl.name,
            sourceLineNo: rule.sourceLineNo,
          });
        }
      }
    }
  }

  // シャドウ・冗長ルール(同一 ACL 内でのルール順序に起因する重複)。
  for (const issue of detectDeviceRuleIssues(device)) {
    const ruleDesc = formatRule(issue.rule);
    const byDesc = formatRule(issue.by);
    if (issue.type === 'shadowed') {
      findings.push({
        category: 'shadowed-rule',
        severity: 'warn',
        title: `${issue.aclName} #${issue.ruleIndex + 1}: ${ruleDesc}`,
        detail: `先行する #${issue.byIndex + 1}「${byDesc}」(L${issue.by.sourceLineNo})が全体を覆い、動作が異なるため、このルールは評価されません(デッドルール)。`,
        aclName: issue.aclName,
        sourceLineNo: issue.rule.sourceLineNo,
      });
    } else {
      findings.push({
        category: 'redundant-rule',
        severity: 'info',
        title: `${issue.aclName} #${issue.ruleIndex + 1}: ${ruleDesc}`,
        detail: `先行する #${issue.byIndex + 1}「${byDesc}」(L${issue.by.sourceLineNo})と同じ動作で範囲が包含されるため、冗長です。`,
        aclName: issue.aclName,
        sourceLineNo: issue.rule.sourceLineNo,
      });
    }
  }

  // 未使用 ACL。
  for (const name of unusedAcls) {
    const acl = device.acls.find((a) => a.name === name);
    findings.push({
      category: 'unused-acl',
      severity: 'warn',
      title: name,
      detail: 'どこにも適用されていません。',
      aclName: name,
      sourceLineNo: acl?.sourceLineNo,
    });
  }

  // 拒否ログ: 適用されている ACL のうち、deny + log を 1 つも持たないもの。
  const boundNames = new Set(device.bindings.map((b) => b.aclName));
  for (const acl of device.acls) {
    if (!boundNames.has(acl.name)) continue; // 未適用は未使用ACL側で扱う
    if (acl.rules.length === 0) continue;
    const hasDenyLog = acl.rules.some((r) => r.action === 'deny' && r.options.log);
    if (!hasDenyLog) {
      findings.push({
        category: 'deny-log',
        severity: 'info',
        title: acl.name,
        detail: '拒否トラフィックをログする deny + log ルールがありません。暗黙 deny で落ちる通信は記録されません。',
        aclName: acl.name,
        sourceLineNo: acl.sourceLineNo,
      });
    }
  }

  return findings;
}

/** カテゴリ別に件数を集計する(サマリ・バッジ用)。 */
export function countByCategory(findings: Finding[]): Record<FindingCategory, number> {
  const counts = {
    'overly-permissive': 0,
    'shadowed-rule': 0,
    'redundant-rule': 0,
    'unused-acl': 0,
    'undefined-acl': 0,
    'undefined-object-group': 0,
    'deny-log': 0,
  } as Record<FindingCategory, number>;
  for (const f of findings) counts[f.category]++;
  return counts;
}
