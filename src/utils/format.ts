import type { AclRule, AddressSpec, PortSpec } from '../types/ir';
import { formatSubnet } from './ip';

/** AddressSpec を表示用文字列に整形する。object-group は "OG:名前" 表記。 */
export function formatAddress(spec: AddressSpec): string {
  switch (spec.kind) {
    case 'any':
      return 'any';
    case 'host':
      return spec.ip;
    case 'subnet':
      return formatSubnet(spec.addr, spec.wildcard);
    case 'objectGroup':
      return `OG:${spec.name}`;
    case 'raw':
      return spec.text;
  }
}

/** ポート指定を表示用文字列に整形する。 */
export function formatPort(spec: PortSpec | undefined): string {
  if (!spec) return '';
  switch (spec.op) {
    case 'range':
      return `range ${spec.from}-${spec.to}`;
    case 'objectGroup':
      return `OG:${spec.name}`;
    default:
      return `${spec.op} ${spec.port}`;
  }
}

/** アドレスが any 相当(強調表示対象)か。 */
export function isAny(spec: AddressSpec): boolean {
  return spec.kind === 'any';
}

/** ACL ルール 1 行を Cisco 風の表示文字列へ整形する(指摘・レポート用)。 */
export function formatRule(rule: AclRule): string {
  const parts = [rule.action, rule.protocol, formatAddress(rule.src)];
  const srcPort = formatPort(rule.srcPort);
  if (srcPort) parts.push(srcPort);
  parts.push(formatAddress(rule.dst));
  const dstPort = formatPort(rule.dstPort);
  if (dstPort) parts.push(dstPort);
  if (rule.options.established) parts.push('established');
  if (rule.options.log) parts.push('log');
  return parts.join(' ');
}
