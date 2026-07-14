import type {
  Acl,
  AclBinding,
  Device,
  Interface,
  ObjectGroup,
  ObjectGroupType,
  ServiceSummary,
} from '../../types/ir';
import { aclTypeFromNumber, parseAclRuleLine } from './acl';
import { tokenize } from './tokens';

/** 行の内容(remark/コメント/空行かどうか)判定用。 */
function isBlank(line: string): boolean {
  const t = line.trim();
  return t.length === 0 || t === '!';
}

/** 先頭の空白量。show run のサブコマンド判定に使う。 */
function indentOf(line: string): number {
  const m = line.match(/^(\s*)/);
  return m ? m[1]!.length : 0;
}

type Block =
  | { kind: 'none' }
  | { kind: 'interface'; iface: Interface }
  | { kind: 'acl'; acl: Acl }
  | { kind: 'objectGroup'; group: ObjectGroup }
  | { kind: 'line'; lineName: string };

/**
 * IOS / IOS-XE の show running-config(全体または抜粋)を IR へ変換する。
 * 解析できない行は unparsedLines に原文保持し、全体が落ちないようにする(基本設計 §3.3)。
 */
export function parseIos(rawLines: string[], id: string, sourceName?: string): Device {
  const device: Device = {
    id,
    sourceName,
    hostname: 'unknown',
    os: 'ios',
    osSupported: true,
    rawLines,
    interfaces: [],
    acls: [],
    bindings: [],
    objectGroups: [],
    services: {},
    unparsedLines: [],
  };
  const services: ServiceSummary = {};

  // named ACL は名前で引けるよう索引しておく(numbered ACL も同じ器に集約する)。
  const aclByName = new Map<string, Acl>();
  const getOrCreateNumberedAcl = (num: number, lineNo: number): Acl | null => {
    const type = aclTypeFromNumber(num);
    if (type === null) return null;
    const key = String(num);
    let acl = aclByName.get(key);
    if (!acl) {
      acl = { name: key, number: num, type, rules: [], sourceLineNo: lineNo };
      aclByName.set(key, acl);
      device.acls.push(acl);
    }
    return acl;
  };

  let block: Block = { kind: 'none' };
  // remark はルールに紐付けるため一時保持する。
  let pendingRemark: string[] = [];

  const markUnparsed = (lineNo: number, text: string) => {
    device.unparsedLines.push({ lineNo, text });
  };

  for (let idx = 0; idx < rawLines.length; idx++) {
    const raw = rawLines[idx]!;
    const lineNo = idx + 1;
    if (isBlank(raw)) {
      pendingRemark = [];
      continue;
    }
    const indent = indentOf(raw);
    const tokens = tokenize(raw);
    const head = tokens[0]!;

    // --- ブロック内サブコマンドの処理(インデントあり、または継続的な ACL 行)---
    if (block.kind === 'acl') {
      // named ACL 配下: remark / permit / deny / seq番号付き。
      if (head === 'remark') {
        pendingRemark.push(tokens.slice(1).join(' '));
        continue;
      }
      if (head === 'permit' || head === 'deny' || /^\d+$/.test(head)) {
        const rule = parseAclRuleLine(raw, block.acl.type, lineNo);
        if (rule) {
          if (pendingRemark.length > 0) {
            rule.remark = pendingRemark;
            pendingRemark = [];
          }
          block.acl.rules.push(rule);
          continue;
        }
      }
      // ACL ブロックを抜ける(下でトップレベルとして再処理)。
      block = { kind: 'none' };
      pendingRemark = [];
    } else if (block.kind === 'interface') {
      if (indent > 0) {
        applyInterfaceSubcommand(block.iface, tokens, lineNo, device, services, markUnparsed);
        continue;
      }
      block = { kind: 'none' };
    } else if (block.kind === 'objectGroup') {
      if (indent > 0) {
        block.group.lines.push(raw.trim());
        continue;
      }
      block = { kind: 'none' };
    } else if (block.kind === 'line') {
      if (indent > 0) {
        applyLineSubcommand(block.lineName, tokens, lineNo, device, services, markUnparsed);
        continue;
      }
      block = { kind: 'none' };
    }

    // --- トップレベルコマンド ---
    switch (head) {
      case 'hostname': {
        if (tokens[1]) device.hostname = tokens[1];
        break;
      }
      case 'version': {
        if (tokens[1]) device.version = tokens[1];
        break;
      }
      case 'interface': {
        const name = tokens.slice(1).join(' ');
        const iface: Interface = {
          name,
          shutdown: false,
          aclBindings: [],
          sourceLineNo: lineNo,
          vlan: /^vlan\s*(\d+)/i.test(name) ? name.replace(/^vlan\s*/i, '') : undefined,
        };
        device.interfaces.push(iface);
        block = { kind: 'interface', iface };
        break;
      }
      case 'access-list': {
        // numbered ACL の 1 行ルール。
        const num = Number(tokens[1]);
        if (Number.isInteger(num)) {
          const acl = getOrCreateNumberedAcl(num, lineNo);
          if (acl) {
            // "access-list <num> remark ..." に対応。
            if (tokens[2] === 'remark') {
              pendingRemark.push(tokens.slice(3).join(' '));
              break;
            }
            const body = tokens.slice(2).join(' ');
            const rule = parseAclRuleLine(body, acl.type, lineNo);
            if (rule) {
              if (pendingRemark.length > 0) {
                rule.remark = pendingRemark;
                pendingRemark = [];
              }
              acl.rules.push(rule);
              break;
            }
          }
        }
        markUnparsed(lineNo, raw);
        break;
      }
      case 'ip': {
        const newBlock = handleIpCommand(tokens, lineNo, raw, device, services, aclByName, markUnparsed);
        if (newBlock) block = newBlock;
        break;
      }
      case 'object-group': {
        const type = normalizeObjectGroupType(tokens[1]);
        const name = tokens[2];
        if (name) {
          const group: ObjectGroup = { name, type, lines: [], sourceLineNo: lineNo };
          device.objectGroups.push(group);
          block = { kind: 'objectGroup', group };
        } else {
          markUnparsed(lineNo, raw);
        }
        break;
      }
      case 'line': {
        const lineName = tokens.slice(1).join(' ');
        block = { kind: 'line', lineName };
        break;
      }
      case 'snmp-server': {
        if (tokens[1] === 'community') {
          services.snmp = true;
          // snmp-server community <name> [RO|RW] [<acl>]
          const acl = tokens[tokens.length - 1];
          const roRw = tokens.find((t) => t === 'RO' || t === 'RW');
          if (roRw && acl && acl !== 'RO' && acl !== 'RW') {
            device.bindings.push({
              aclName: acl,
              kind: 'snmp',
              target: tokens[2] ?? '',
              sourceLineNo: lineNo,
            });
          }
        } else if (tokens[1]) {
          services.snmp = true;
        }
        break;
      }
      default: {
        markUnparsed(lineNo, raw);
      }
    }
  }

  // vty access-class を services にも反映。
  const vtyAcls = device.bindings.filter((b) => b.kind === 'line').map((b) => b.aclName);
  if (vtyAcls.length > 0) services.vtyAccessClass = [...new Set(vtyAcls)];

  device.services = services;
  return device;
}

function normalizeObjectGroupType(t: string | undefined): ObjectGroupType {
  if (t === 'network' || t === 'service' || t === 'protocol') return t;
  return 'other';
}

/** interface ブロック内のサブコマンドを反映。 */
function applyInterfaceSubcommand(
  iface: Interface,
  tokens: string[],
  lineNo: number,
  device: Device,
  _services: ServiceSummary,
  markUnparsed: (lineNo: number, text: string) => void,
): void {
  const head = tokens[0]!;
  if (head === 'ip' && tokens[1] === 'address') {
    iface.ip = tokens.slice(2).join(' ');
  } else if (head === 'description') {
    iface.description = tokens.slice(1).join(' ');
  } else if (head === 'shutdown') {
    iface.shutdown = true;
  } else if (head === 'ip' && tokens[1] === 'access-group') {
    const aclName = tokens[2];
    const direction = tokens[3] === 'in' || tokens[3] === 'out' ? tokens[3] : undefined;
    if (aclName) {
      const binding: AclBinding = {
        aclName,
        kind: 'interface',
        target: iface.name,
        direction,
        sourceLineNo: lineNo,
      };
      iface.aclBindings.push(binding);
      device.bindings.push(binding);
    }
  } else if (head === 'encapsulation' && tokens[1] === 'dot1q' && tokens[2]) {
    iface.vlan = tokens[2];
  } else if (head === 'switchport' && tokens[1] === 'access' && tokens[2] === 'vlan' && tokens[3]) {
    iface.vlan = tokens[3];
  } else if (head === 'no' && tokens[1] === 'shutdown') {
    iface.shutdown = false;
  } else {
    // interface 配下の未対応行はノイズが多いので unparsed には積まない(俯瞰目的では不要)。
    void markUnparsed;
  }
}

/** line(vty 等)ブロック内のサブコマンドを反映。 */
function applyLineSubcommand(
  lineName: string,
  tokens: string[],
  lineNo: number,
  device: Device,
  services: ServiceSummary,
  _markUnparsed: (lineNo: number, text: string) => void,
): void {
  const head = tokens[0]!;
  if (head === 'access-class') {
    const aclName = tokens[1];
    const direction = tokens[2] === 'in' || tokens[2] === 'out' ? tokens[2] : undefined;
    if (aclName) {
      device.bindings.push({
        aclName,
        kind: 'line',
        target: lineName,
        direction,
        sourceLineNo: lineNo,
      });
    }
  } else if (head === 'transport' && tokens[1] === 'input') {
    const modes = tokens.slice(2);
    if (modes.includes('ssh') || modes.includes('all')) services.ssh = true;
    if (modes.includes('telnet') || modes.includes('all')) services.telnet = true;
  }
}

/**
 * "ip ..." で始まるトップレベルコマンドを処理。
 * named ACL の場合は開始すべきブロックを返す(呼び出し側で block に代入する)。
 */
function handleIpCommand(
  tokens: string[],
  lineNo: number,
  raw: string,
  device: Device,
  services: ServiceSummary,
  aclByName: Map<string, Acl>,
  markUnparsed: (lineNo: number, text: string) => void,
): Block | undefined {
  // ip access-list standard|extended NAME → named ACL ブロック
  if (tokens[1] === 'access-list') {
    const type = tokens[2];
    if (type === 'standard' || type === 'extended') {
      const name = tokens[3];
      if (name) {
        let acl = aclByName.get(name);
        if (!acl) {
          acl = { name, type, rules: [], sourceLineNo: lineNo };
          aclByName.set(name, acl);
          device.acls.push(acl);
        }
        return { kind: 'acl', acl };
      }
    }
    markUnparsed(lineNo, raw);
    return undefined;
  }
  // ip http server / secure-server
  if (tokens[1] === 'http') {
    if (tokens[2] === 'server') services.httpServer = true;
    else if (tokens[2] === 'secure-server') services.httpsServer = true;
    return undefined;
  }
  // ip ssh ... はサービス有効の示唆。
  if (tokens[1] === 'ssh') {
    services.ssh = services.ssh ?? true;
    return undefined;
  }
  // その他 ip コマンドは俯瞰対象外(unparsed には積まない)。
  return undefined;
}
