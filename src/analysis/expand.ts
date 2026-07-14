import type { Device, ObjectGroup } from '../types/ir';
import { formatSubnet, maskToWildcard } from '../utils/ip';

// object-group / object の展開(基本設計 §3.4 / §10-2)。
// network グループはアドレス文字列、service グループはポート/サービス文字列へ展開する。
// group-object(グループのネスト)と ASA の "object" 参照を再帰解決し、循環は打ち切る。

export interface ExpandResult {
  /** 展開後の表示要素(アドレスまたはポート文字列)。 */
  members: string[];
  /** 参照先が見つからなかった名前(未定義参照)。 */
  missing: string[];
  /** 循環参照を検出したか。 */
  cyclic: boolean;
}

const IPV4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/** device 内の object-group / object を名前で引く索引を作る。 */
export function buildGroupIndex(device: Device): Map<string, ObjectGroup> {
  const map = new Map<string, ObjectGroup>();
  for (const g of device.objectGroups) {
    // 同名は先勝ち(通常は衝突しない)。
    if (!map.has(g.name)) map.set(g.name, g);
  }
  return map;
}

/** ネットワーク系グループを展開してアドレス文字列の一覧にする。 */
export function expandNetworkGroup(
  name: string,
  index: Map<string, ObjectGroup>,
): ExpandResult {
  const acc: ExpandResult = { members: [], missing: [], cyclic: false };
  const seen = new Set<string>();
  walkNetwork(name, index, acc, seen);
  // 重複を除去しつつ順序を保つ。
  acc.members = dedupe(acc.members);
  acc.missing = dedupe(acc.missing);
  return acc;
}

/** サービス系グループを展開してポート/サービス文字列の一覧にする。 */
export function expandServiceGroup(
  name: string,
  index: Map<string, ObjectGroup>,
): ExpandResult {
  const acc: ExpandResult = { members: [], missing: [], cyclic: false };
  const seen = new Set<string>();
  walkService(name, index, acc, seen);
  acc.members = dedupe(acc.members);
  acc.missing = dedupe(acc.missing);
  return acc;
}

function walkNetwork(
  name: string,
  index: Map<string, ObjectGroup>,
  acc: ExpandResult,
  seen: Set<string>,
): void {
  if (seen.has(name)) {
    acc.cyclic = true;
    return;
  }
  const group = index.get(name);
  if (!group) {
    acc.missing.push(name);
    return;
  }
  seen.add(name);
  for (const raw of group.lines) {
    const member = parseNetworkMember(raw);
    if (!member) continue;
    if (member.kind === 'ref') walkNetwork(member.name, index, acc, seen);
    else acc.members.push(member.text);
  }
  seen.delete(name);
}

function walkService(
  name: string,
  index: Map<string, ObjectGroup>,
  acc: ExpandResult,
  seen: Set<string>,
): void {
  if (seen.has(name)) {
    acc.cyclic = true;
    return;
  }
  const group = index.get(name);
  if (!group) {
    acc.missing.push(name);
    return;
  }
  seen.add(name);
  for (const raw of group.lines) {
    const member = parseServiceMember(raw);
    if (!member) continue;
    if (member.kind === 'ref') walkService(member.name, index, acc, seen);
    else acc.members.push(member.text);
  }
  seen.delete(name);
}

type Member = { kind: 'value'; text: string } | { kind: 'ref'; name: string };

/**
 * ネットワークグループ / object network のメンバ行を解釈する。
 * IOS:  "host X" / "A.B.C.D M.M.M.M" / "range X Y" / "group-object G"
 * ASA:  "network-object host X" / "network-object A.B.C.D M.M.M.M" / "network-object object O" /
 *       "subnet A.B.C.D M.M.M.M" / "host X" / "range X Y" / "group-object G"
 */
export function parseNetworkMember(line: string): Member | null {
  let toks = line.trim().split(/\s+/).filter(Boolean);
  if (toks.length === 0) return null;
  // 先頭の修飾子を剥がす。
  if (toks[0] === 'network-object' || toks[0] === 'subnet') toks = toks.slice(1);
  if (toks.length === 0) return null;

  const head = toks[0]!;
  if (head === 'description') return null;
  if (head === 'group-object') {
    return toks[1] ? { kind: 'ref', name: toks[1] } : null;
  }
  if (head === 'object') {
    // ASA: network-object object NAME(単一 object 参照)
    return toks[1] ? { kind: 'ref', name: toks[1] } : null;
  }
  if (head === 'host') {
    return toks[1] ? { kind: 'value', text: toks[1] } : null;
  }
  if (head === 'range') {
    return toks[1] && toks[2] ? { kind: 'value', text: `${toks[1]}-${toks[2]}` } : null;
  }
  if (head === 'fqdn') {
    // "fqdn v4 example.com" 等。ドメイン名をそのまま表示。
    return { kind: 'value', text: toks.slice(1).join(' ') };
  }
  if (IPV4_RE.test(head)) {
    const mask = toks[1];
    if (mask && IPV4_RE.test(mask)) {
      // object-group network / ASA は netmask 表記。ワイルドカードへ変換して CIDR 整形。
      const wildcard = maskToWildcard(mask);
      return { kind: 'value', text: wildcard ? formatSubnet(head, wildcard) : `${head} ${mask}` };
    }
    return { kind: 'value', text: head };
  }
  return null;
}

/**
 * サービスグループ / object service のメンバ行を解釈する。
 * ASA:  "port-object eq www" / "port-object range 1 100" /
 *       "service-object tcp destination eq https" / "group-object G"
 * IOS:  "tcp eq 80" / "eq 80" / "group-object G"
 */
export function parseServiceMember(line: string): Member | null {
  const toks = line.trim().split(/\s+/).filter(Boolean);
  if (toks.length === 0) return null;
  const head = toks[0]!;
  if (head === 'description') return null;
  if (head === 'group-object') {
    return toks[1] ? { kind: 'ref', name: toks[1] } : null;
  }
  if (head === 'port-object') {
    // port-object eq X / port-object range X Y
    const rest = toks.slice(1);
    return { kind: 'value', text: rest.join(' ') };
  }
  if (head === 'service-object') {
    // service-object tcp destination eq https → "tcp https" に簡約
    const rest = toks.slice(1).filter((t) => t !== 'destination' && t !== 'source' && t !== 'eq');
    return { kind: 'value', text: rest.join(' ') };
  }
  // IOS 形式や eq/range 直書き。
  return { kind: 'value', text: toks.join(' ') };
}

function dedupe(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of arr) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}
