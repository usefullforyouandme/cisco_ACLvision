import type { AddressSpec, PortSpec } from '../../types/ir';
import { maskToWildcard } from '../../utils/ip';

const IPV4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

export function isIpv4(token: string): boolean {
  return IPV4_RE.test(token);
}

/**
 * ASA の ACE からアドレス指定を 1 つ読み取る。
 * IOS と違いサブネットは netmask 表記なのでワイルドカードへ変換して保持する。
 * any / any4 / any6 / host X / A.B.C.D M.M.M.M / object NAME / object-group NAME / interface NAME。
 */
export function consumeAddressAsa(tokens: string[], i: number): { spec: AddressSpec; next: number } {
  const t = tokens[i];
  if (t === undefined) return { spec: { kind: 'raw', text: '' }, next: i };

  if (t === 'any' || t === 'any4' || t === 'any6') {
    return { spec: { kind: 'any' }, next: i + 1 };
  }
  if (t === 'host') {
    const ip = tokens[i + 1];
    if (ip !== undefined && isIpv4(ip)) return { spec: { kind: 'host', ip }, next: i + 2 };
    return { spec: { kind: 'raw', text: [t, ip ?? ''].join(' ').trim() }, next: i + 2 };
  }
  if (t === 'object' || t === 'object-group') {
    const name = tokens[i + 1];
    if (name !== undefined) return { spec: { kind: 'objectGroup', name }, next: i + 2 };
    return { spec: { kind: 'raw', text: t }, next: i + 1 };
  }
  if (t === 'interface') {
    const name = tokens[i + 1];
    return { spec: { kind: 'raw', text: `interface ${name ?? ''}`.trim() }, next: i + 2 };
  }
  if (isIpv4(t)) {
    const mask = tokens[i + 1];
    if (mask !== undefined && isIpv4(mask)) {
      const wildcard = maskToWildcard(mask) ?? mask;
      return { spec: { kind: 'subnet', addr: t, wildcard }, next: i + 2 };
    }
    return { spec: { kind: 'host', ip: t }, next: i + 1 };
  }
  return { spec: { kind: 'raw', text: t }, next: i + 1 };
}

const PORT_OPS = new Set(['eq', 'gt', 'lt', 'neq']);

/** ASA の ACE からポート指定を読み取る。ポート名(www/https 等)も許容する。 */
export function consumePortAsa(
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
  if (t === 'object-group') {
    const name = tokens[i + 1];
    if (name !== undefined) return { spec: { op: 'objectGroup', name }, next: i + 2 };
  }
  return { spec: undefined, next: i };
}
