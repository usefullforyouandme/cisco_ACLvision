import type { AddressSpec, PortSpec } from '../../types/ir';

/** 行を空白区切りのトークン列へ。先頭・末尾の空白は無視する。 */
export function tokenize(line: string): string[] {
  return line.trim().split(/\s+/).filter((t) => t.length > 0);
}

const IPV4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

export function isIpv4(token: string): boolean {
  return IPV4_RE.test(token);
}

/**
 * トークン列の位置 i からアドレス指定を 1 つ読み取る。
 * extended ACL の src/dst を想定(any / host X / X wildcard / object-group NAME / addrgroup NAME)。
 * 戻り値の next は次に読むべきインデックス。
 */
export function consumeAddress(tokens: string[], i: number): { spec: AddressSpec; next: number } {
  const t = tokens[i];
  if (t === undefined) return { spec: { kind: 'raw', text: '' }, next: i };

  if (t === 'any' || t === 'any4') {
    return { spec: { kind: 'any' }, next: i + 1 };
  }
  if (t === 'host') {
    const ip = tokens[i + 1];
    if (ip !== undefined && isIpv4(ip)) {
      return { spec: { kind: 'host', ip }, next: i + 2 };
    }
    return { spec: { kind: 'raw', text: [t, ip ?? ''].join(' ').trim() }, next: i + 2 };
  }
  if (t === 'object-group' || t === 'addrgroup' || t === 'group-object') {
    const name = tokens[i + 1];
    if (name !== undefined) {
      return { spec: { kind: 'objectGroup', name }, next: i + 2 };
    }
    return { spec: { kind: 'raw', text: t }, next: i + 1 };
  }
  if (isIpv4(t)) {
    const wildcard = tokens[i + 1];
    if (wildcard !== undefined && isIpv4(wildcard)) {
      return { spec: { kind: 'subnet', addr: t, wildcard }, next: i + 2 };
    }
    // ワイルドカードを伴わない裸の IP(host 相当)。
    return { spec: { kind: 'host', ip: t }, next: i + 1 };
  }
  // 解析できないアドレス表現は原文 1 トークンを保持。
  return { spec: { kind: 'raw', text: t }, next: i + 1 };
}

const PORT_OPS = new Set(['eq', 'gt', 'lt', 'neq']);

/**
 * 位置 i からポート指定を読み取る。ポート指定でなければ undefined を返し、next は据え置き。
 * TCP/UDP のみで意味を持つ(呼び出し側で protocol を判定する)。
 */
export function consumePort(
  tokens: string[],
  i: number,
): { spec: PortSpec | undefined; next: number } {
  const t = tokens[i];
  if (t === undefined) return { spec: undefined, next: i };

  if (PORT_OPS.has(t)) {
    const port = tokens[i + 1];
    if (port !== undefined) {
      return { spec: { op: t as 'eq' | 'gt' | 'lt' | 'neq', port }, next: i + 2 };
    }
  }
  if (t === 'range') {
    const from = tokens[i + 1];
    const to = tokens[i + 2];
    if (from !== undefined && to !== undefined) {
      return { spec: { op: 'range', from, to }, next: i + 3 };
    }
  }
  if (t === 'object-group' || t === 'portgroup') {
    // service object-group によるポート指定。
    const name = tokens[i + 1];
    if (name !== undefined) {
      return { spec: { op: 'objectGroup', name }, next: i + 2 };
    }
  }
  return { spec: undefined, next: i };
}
