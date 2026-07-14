import type { AclRule, AclType } from '../../types/ir';
import { consumeAddress, consumePort, tokenize } from './tokens';

/** numbered ACL の番号帯から standard / extended を判定。判定不能なら null。 */
export function aclTypeFromNumber(num: number): AclType | null {
  if ((num >= 1 && num <= 99) || (num >= 1300 && num <= 1999)) return 'standard';
  if ((num >= 100 && num <= 199) || (num >= 2000 && num <= 2699)) return 'extended';
  return null;
}

const PORTED_PROTOCOLS = new Set(['tcp', 'udp', '6', '17']);

/** log / log-input / established などの末尾オプションを解釈する。 */
function parseOptions(rest: string[]): AclRule['options'] {
  const options: AclRule['options'] = {};
  const extra: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i]!;
    if (t === 'log' || t === 'log-input') options.log = true;
    else if (t === 'established') options.established = true;
    else extra.push(t);
  }
  if (extra.length > 0) options.extra = extra;
  return options;
}

/**
 * standard ACL の 1 ルール本体を解析する。
 * tokens[startIndex] が action("permit"/"deny")であること。
 * 例: permit 10.0.0.0 0.0.0.255 / deny host 1.2.3.4 / permit any
 */
function parseStandardRule(
  tokens: string[],
  startIndex: number,
  sourceLineNo: number,
  seq: number | undefined,
): AclRule | null {
  const action = tokens[startIndex];
  if (action !== 'permit' && action !== 'deny') return null;
  const { spec: src, next } = consumeAddress(tokens, startIndex + 1);
  return {
    seq,
    action,
    protocol: 'ip',
    src,
    dst: { kind: 'any' },
    options: parseOptions(tokens.slice(next)),
    sourceLineNo,
  };
}

/**
 * extended ACL の 1 ルール本体を解析する。
 * tokens[startIndex] が action であること。
 * 例: permit tcp 10.0.0.0 0.0.0.255 eq 80 host 1.2.3.4 established log
 */
function parseExtendedRule(
  tokens: string[],
  startIndex: number,
  sourceLineNo: number,
  seq: number | undefined,
): AclRule | null {
  const action = tokens[startIndex];
  if (action !== 'permit' && action !== 'deny') return null;
  const protocol = tokens[startIndex + 1];
  if (protocol === undefined) return null;

  let i = startIndex + 2;
  const { spec: src, next: afterSrc } = consumeAddress(tokens, i);
  i = afterSrc;

  const ported = PORTED_PROTOCOLS.has(protocol);
  let srcPort: AclRule['srcPort'];
  if (ported) {
    const { spec, next } = consumePort(tokens, i);
    srcPort = spec;
    i = next;
  }

  const { spec: dst, next: afterDst } = consumeAddress(tokens, i);
  i = afterDst;

  let dstPort: AclRule['dstPort'];
  if (ported) {
    const { spec, next } = consumePort(tokens, i);
    dstPort = spec;
    i = next;
  }

  return {
    seq,
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

/** ACL の 1 ルール行を type に応じて解析する。action 行でなければ null。 */
export function parseAclRuleLine(
  line: string,
  type: AclType,
  sourceLineNo: number,
): AclRule | null {
  const tokens = tokenize(line);
  if (tokens.length === 0) return null;

  // 先頭がシーケンス番号のこともある(named ACL 配下)。
  let start = 0;
  let seq: number | undefined;
  if (/^\d+$/.test(tokens[0]!)) {
    seq = Number(tokens[0]);
    start = 1;
  }

  const action = tokens[start];
  if (action !== 'permit' && action !== 'deny') return null;

  return type === 'standard'
    ? parseStandardRule(tokens, start, sourceLineNo, seq)
    : parseExtendedRule(tokens, start, sourceLineNo, seq);
}
