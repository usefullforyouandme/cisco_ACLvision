import type { Acl, AclRule, AddressSpec, Device, PortSpec } from '../types/ir';
import { ipToInt, wildcardToPrefix } from '../utils/ip';

// シャドウ・冗長ルール検出(基本設計 §4.2 V4 / Phase 4)。
//
// 同一 ACL 内で、先行ルールが後続ルールのマッチ空間を「完全に包含」する場合を検出する。
//   - 動作が異なる  → シャドウ(後続ルールは評価されないデッドルール)
//   - 動作が同じ    → 冗長(削除しても挙動が変わらない)
//
// 誤検知(健全なルールを問題と誤報)を避けることを最優先とし、包含が確実に言えない要素
// (object-group・raw アドレス・不連続ワイルドカード・neq/名前ポートなど)は
// 「包含しない」と保守的に判定する。結果として一部の真の重複は見逃すが、それは
// 「判断は人間が行う」という本ツールの方針に沿う。

const U32_MAX = 0xffffffff;

interface Range {
  lo: number;
  hi: number;
}

/** AddressSpec を [lo, hi] の 32bit 数値レンジへ。判定不能なら null。 */
function addrToRange(spec: AddressSpec): Range | null {
  switch (spec.kind) {
    case 'any':
      return { lo: 0, hi: U32_MAX };
    case 'host': {
      const ip = ipToInt(spec.ip);
      return ip === null ? null : { lo: ip, hi: ip };
    }
    case 'subnet': {
      const a = ipToInt(spec.addr);
      const w = ipToInt(spec.wildcard);
      if (a === null || w === null) return null;
      // 連続ワイルドカード(= CIDR 化できるもの)のみレンジ化する。不連続は判定不能。
      if (wildcardToPrefix(spec.wildcard) === null) return null;
      const lo = (a & ~w) >>> 0;
      const hi = (lo | w) >>> 0;
      return { lo, hi };
    }
    default:
      // objectGroup / raw は実体不明。
      return null;
  }
}

/** アドレス a が b を包含するか(a ⊇ b)。判定不能なら false。 */
function addrCovers(a: AddressSpec, b: AddressSpec): boolean {
  if (a.kind === 'any') return true;
  // 同一 object-group / 同一 raw は同じ集合とみなす(完全一致ルールを冗長として拾うため)。
  if (a.kind === 'objectGroup' && b.kind === 'objectGroup') return a.name === b.name;
  if (a.kind === 'raw' && b.kind === 'raw') return a.text === b.text;
  const ra = addrToRange(a);
  const rb = addrToRange(b);
  if (!ra || !rb) return false;
  return ra.lo <= rb.lo && ra.hi >= rb.hi;
}

/** ポート番号(数値)へ。名前(www 等)や非数値は null。 */
function portNum(port: string): number | null {
  if (!/^\d{1,5}$/.test(port)) return null;
  const n = Number(port);
  return n <= 65535 ? n : null;
}

/** PortSpec を数値レンジへ。判定不能なら null。 */
function portToRange(spec: PortSpec): Range | null {
  switch (spec.op) {
    case 'eq': {
      const p = portNum(spec.port);
      return p === null ? null : { lo: p, hi: p };
    }
    case 'range': {
      const a = portNum(spec.from);
      const b = portNum(spec.to);
      return a === null || b === null ? null : { lo: a, hi: b };
    }
    case 'gt': {
      const p = portNum(spec.port);
      return p === null ? null : { lo: p + 1, hi: 65535 };
    }
    case 'lt': {
      const p = portNum(spec.port);
      return p === null ? null : { lo: 0, hi: p - 1 };
    }
    case 'neq':
      // 非連続集合。レンジで表現できない。
      return null;
    case 'objectGroup':
      return null;
  }
}

/** 2 つの PortSpec が構造的に等しいか(名前ポートの完全一致を拾う)。 */
function portEqual(a: PortSpec, b: PortSpec): boolean {
  if (a.op !== b.op) return false;
  if (a.op === 'range' && b.op === 'range') return a.from === b.from && a.to === b.to;
  if (a.op === 'objectGroup' && b.op === 'objectGroup') return a.name === b.name;
  if ('port' in a && 'port' in b) return a.port === b.port;
  return false;
}

/** ポート制約 a が b を包含するか(未指定=全ポート)。 */
function portCovers(a: PortSpec | undefined, b: PortSpec | undefined): boolean {
  if (!a) return true; // a に制約なし = 全ポートを含む
  if (!b) return false; // b が全ポート、a は限定 → 包含しない
  if (portEqual(a, b)) return true;
  const ra = portToRange(a);
  const rb = portToRange(b);
  if (!ra || !rb) return false;
  return ra.lo <= rb.lo && ra.hi >= rb.hi;
}

/** プロトコル a が b を包含するか。ip は全 IP プロトコルを包含する。 */
function protoCovers(a: string, b: string): boolean {
  if (a === b) return true;
  return a === 'ip';
}

/**
 * ルール a が b のマッチ空間を完全に包含するか(a ⊇ b)。
 * established は「確立済みセッションのみ」に絞る制約なので、a のみ established の場合は包含しない。
 */
export function ruleCovers(a: AclRule, b: AclRule): boolean {
  if (a.options.established && !b.options.established) return false;
  return (
    protoCovers(a.protocol, b.protocol) &&
    addrCovers(a.src, b.src) &&
    addrCovers(a.dst, b.dst) &&
    portCovers(a.srcPort, b.srcPort) &&
    portCovers(a.dstPort, b.dstPort)
  );
}

export type RuleIssueType = 'shadowed' | 'redundant';

/** シャドウ / 冗長として検出された 1 件。 */
export interface RuleIssue {
  type: RuleIssueType;
  aclName: string;
  /** 問題のある(後続)ルールと ACL 内での 0 始まり位置。 */
  rule: AclRule;
  ruleIndex: number;
  /** そのルールを覆っている先行ルールと位置。 */
  by: AclRule;
  byIndex: number;
}

/** 1 つの ACL 内のシャドウ・冗長ルールを検出する。 */
export function detectRuleIssues(acl: Acl): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const { rules } = acl;
  for (let j = 1; j < rules.length; j++) {
    const rj = rules[j]!;
    for (let i = 0; i < j; i++) {
      const ri = rules[i]!;
      if (ruleCovers(ri, rj)) {
        issues.push({
          type: ri.action === rj.action ? 'redundant' : 'shadowed',
          aclName: acl.name,
          rule: rj,
          ruleIndex: j,
          by: ri,
          byIndex: i,
        });
        break; // 最初に覆う先行ルールのみ報告する(1 ルール 1 指摘)。
      }
    }
  }
  return issues;
}

/** 装置内の全 ACL のシャドウ・冗長ルールを検出する。 */
export function detectDeviceRuleIssues(device: Device): RuleIssue[] {
  return device.acls.flatMap(detectRuleIssues);
}
