import type { AclRule, AclType } from '../../types/ir';
import { consumeAddressAsa, consumePortAsa } from './tokens';

const PORTED_PROTOCOLS = new Set(['tcp', 'udp', '6', '17']);

function parseOptions(rest: string[]): AclRule['options'] {
  const options: AclRule['options'] = {};
  const extra: string[] = [];
  for (const t of rest) {
    if (t === 'log') options.log = true;
    else if (t === 'inactive' || t === 'disable') extra.push(t);
    else if (options.log) extra.push(t); // log の後続(level/interval 等)
    else extra.push(t);
  }
  if (extra.length > 0) options.extra = extra;
  return options;
}

/**
 * ASA の ACE 本体(access-list NAME [extended|standard] の後ろ)を解析する。
 * tokens[startIndex] は action("permit"/"deny")であること。
 */
export function parseAsaAce(
  tokens: string[],
  startIndex: number,
  type: AclType,
  sourceLineNo: number,
): AclRule | null {
  const action = tokens[startIndex];
  if (action !== 'permit' && action !== 'deny') return null;

  if (type === 'standard') {
    // access-list NAME standard permit A.B.C.D M.M.M.M | host X | any
    const { spec: src } = consumeAddressAsa(tokens, startIndex + 1);
    return {
      action,
      protocol: 'ip',
      src,
      dst: { kind: 'any' },
      options: {},
      sourceLineNo,
    };
  }

  let i = startIndex + 1;
  let protocol: string;
  let ported = false;
  const p = tokens[i];
  if (p === 'object' || p === 'object-group') {
    // service object / protocol group によるプロトコル指定。名前を protocol 欄に表示。
    protocol = tokens[i + 1] ?? p;
    i += 2;
  } else {
    protocol = p ?? 'ip';
    ported = PORTED_PROTOCOLS.has(protocol);
    i += 1;
  }

  const { spec: src, next: afterSrc } = consumeAddressAsa(tokens, i);
  i = afterSrc;

  let srcPort: AclRule['srcPort'];
  if (ported) {
    const r = consumePortAsa(tokens, i);
    srcPort = r.spec;
    i = r.next;
  }

  const { spec: dst, next: afterDst } = consumeAddressAsa(tokens, i);
  i = afterDst;

  let dstPort: AclRule['dstPort'];
  if (ported) {
    const r = consumePortAsa(tokens, i);
    dstPort = r.spec;
    i = r.next;
  }

  return {
    action,
    protocol,
    src,
    srcPort,
    dst,
    dstPort,
    options: parseOptions(tokens.slice(i)),
    sourceLineNo,
  };
}
