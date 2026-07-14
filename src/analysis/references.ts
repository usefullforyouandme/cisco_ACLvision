import type { AclRule, Device } from '../types/ir';
import { matchesWildcard } from '../utils/ip';

/** ACL 参照解決の結果(未使用 ACL・未定義参照)。 */
export interface ReferenceReport {
  /** 定義されているがどこにも適用されていない ACL 名。 */
  unusedAcls: string[];
  /** 適用されているが定義が存在しない ACL 名。 */
  undefinedAcls: string[];
}

/**
 * ACL 定義と適用箇所(bindings)を突合し、未使用・未定義を導出する(基本設計 §4.2 V4 の一部)。
 * Phase 1 ではサマリの警告表示に用いる。
 */
export function analyzeReferences(device: Device): ReferenceReport {
  const definedNames = new Set(device.acls.map((a) => a.name));
  const boundNames = new Set(device.bindings.map((b) => b.aclName));

  const unusedAcls = [...definedNames].filter((n) => !boundNames.has(n)).sort();
  const undefinedAcls = [...boundNames].filter((n) => !definedNames.has(n)).sort();

  return { unusedAcls, undefinedAcls };
}

/** src / dst / port がすべて any の過大許可ルール(permit ip any any 等)か。 */
export function isOverlyPermissive(rule: AclRule): boolean {
  return (
    rule.action === 'permit' &&
    rule.src.kind === 'any' &&
    rule.dst.kind === 'any' &&
    !rule.srcPort &&
    !rule.dstPort
  );
}

/** 装置内の過大許可ルール件数。V1 サマリのハイライト用。 */
export function countOverlyPermissive(device: Device): number {
  let count = 0;
  for (const acl of device.acls) {
    for (const rule of acl.rules) {
      if (isOverlyPermissive(rule)) count++;
    }
  }
  return count;
}

/** ルールの src または dst が対象 IP を含みうるか(V2 の IP フィルタ用)。 */
export function ruleMatchesIp(rule: AclRule, target: string): boolean {
  return specMatchesIp(rule.src, target) || specMatchesIp(rule.dst, target);
}

function specMatchesIp(spec: AclRule['src'], target: string): boolean {
  switch (spec.kind) {
    case 'any':
      return true;
    case 'host':
      return spec.ip === target;
    case 'subnet':
      return matchesWildcard(target, spec.addr, spec.wildcard);
    case 'objectGroup':
    case 'raw':
      // 展開前 object-group / 生表現は判定不能。フィルタでは除外しない(取りこぼし防止)。
      return false;
  }
}
