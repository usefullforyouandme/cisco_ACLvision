import type {
  Acl,
  AclBinding,
  AclType,
  Device,
  Interface,
  ObjectGroup,
  ObjectGroupType,
  ServiceSummary,
} from '../../types/ir';
import { parseAsaAce } from './acl';

function isBlank(line: string): boolean {
  const t = line.trim();
  return t.length === 0 || t === '!';
}

function indentOf(line: string): number {
  const m = line.match(/^(\s*)/);
  return m ? m[1]!.length : 0;
}

function tokenize(line: string): string[] {
  return line.trim().split(/\s+/).filter((t) => t.length > 0);
}

type Block =
  | { kind: 'none' }
  | { kind: 'interface'; iface: Interface }
  | { kind: 'object'; group: ObjectGroup }
  | { kind: 'objectGroup'; group: ObjectGroup };

/**
 * ASA の show running-config(全体または抜粋)を IR へ変換する。
 * IOS と同様、解析できない行は unparsedLines に原文保持する(基本設計 §3.3)。
 */
export function parseAsa(rawLines: string[], id: string, sourceName?: string): Device {
  const device: Device = {
    id,
    sourceName,
    hostname: 'unknown',
    os: 'asa',
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

  const aclByName = new Map<string, Acl>();
  const getOrCreateAcl = (name: string, type: AclType, lineNo: number): Acl => {
    let acl = aclByName.get(name);
    if (!acl) {
      acl = { name, type, rules: [], sourceLineNo: lineNo };
      aclByName.set(name, acl);
      device.acls.push(acl);
    }
    return acl;
  };
  // remark は ACL 名ごとに保持し、次の ACE に紐付ける。
  const pendingRemark = new Map<string, string[]>();

  let block: Block = { kind: 'none' };

  for (let idx = 0; idx < rawLines.length; idx++) {
    const raw = rawLines[idx]!;
    const lineNo = idx + 1;
    if (isBlank(raw)) continue;
    const indent = indentOf(raw);
    const tokens = tokenize(raw);
    const head = tokens[0]!;

    // --- ブロック内サブコマンド ---
    if (block.kind !== 'none') {
      if (indent > 0) {
        if (block.kind === 'interface') applyInterfaceSub(block.iface, tokens);
        else block.group.lines.push(raw.trim());
        continue;
      }
      block = { kind: 'none' };
    }

    // --- トップレベル ---
    if (head === 'ASA' && tokens[1] === 'Version') {
      device.version = tokens[2];
      continue;
    }
    switch (head) {
      case 'hostname': {
        if (tokens[1]) device.hostname = tokens[1];
        break;
      }
      case 'interface': {
        const name = tokens.slice(1).join(' ');
        const iface: Interface = { name, shutdown: false, aclBindings: [], sourceLineNo: lineNo };
        device.interfaces.push(iface);
        block = { kind: 'interface', iface };
        break;
      }
      case 'object': {
        // object network|service NAME(単一オブジェクト)
        const type = normalizeType(tokens[1]);
        const name = tokens[2];
        if (name) {
          const group: ObjectGroup = { name, type, lines: [], isObject: true, sourceLineNo: lineNo };
          device.objectGroups.push(group);
          block = { kind: 'object', group };
        }
        break;
      }
      case 'object-group': {
        const type = normalizeType(tokens[1]);
        const name = tokens[2];
        if (name) {
          const group: ObjectGroup = { name, type, lines: [], sourceLineNo: lineNo };
          device.objectGroups.push(group);
          block = { kind: 'objectGroup', group };
        }
        break;
      }
      case 'access-list': {
        handleAccessList(tokens, lineNo, raw, getOrCreateAcl, pendingRemark, device);
        break;
      }
      case 'access-group': {
        // access-group NAME {in|out} interface NAMEIF
        const aclName = tokens[1];
        const direction = tokens[2] === 'in' || tokens[2] === 'out' ? tokens[2] : undefined;
        const nameif = tokens[3] === 'interface' ? tokens[4] : undefined;
        if (aclName && nameif) {
          const binding: AclBinding = {
            aclName,
            kind: 'interface',
            target: nameif,
            direction,
            sourceLineNo: lineNo,
          };
          device.bindings.push(binding);
          const iface = device.interfaces.find((i) => i.nameif === nameif);
          if (iface) iface.aclBindings.push(binding);
        }
        break;
      }
      case 'ssh': {
        if (tokens.length >= 2) services.ssh = true;
        break;
      }
      case 'telnet': {
        if (tokens.length >= 2) services.telnet = true;
        break;
      }
      case 'http': {
        if (tokens[1] === 'server' && tokens[2] === 'enable') services.httpServer = true;
        break;
      }
      case 'snmp-server': {
        services.snmp = true;
        break;
      }
      case 'names':
      case 'name':
      case 'boot':
      case 'dns':
      case 'mtu':
        // ASA の定型行。俯瞰対象外。
        break;
      default: {
        device.unparsedLines.push({ lineNo, text: raw });
      }
    }
  }

  device.services = services;
  return device;
}

function normalizeType(t: string | undefined): ObjectGroupType {
  if (t === 'network' || t === 'service' || t === 'protocol') return t;
  return 'other';
}

function applyInterfaceSub(iface: Interface, tokens: string[]): void {
  const head = tokens[0]!;
  if (head === 'nameif') {
    iface.nameif = tokens[1];
  } else if (head === 'ip' && tokens[1] === 'address') {
    iface.ip = tokens.slice(2).join(' ');
  } else if (head === 'description') {
    iface.description = tokens.slice(1).join(' ');
  } else if (head === 'shutdown') {
    iface.shutdown = true;
  } else if (head === 'vlan') {
    iface.vlan = tokens[1];
  }
}

function handleAccessList(
  tokens: string[],
  lineNo: number,
  raw: string,
  getOrCreateAcl: (name: string, type: AclType, lineNo: number) => Acl,
  pendingRemark: Map<string, string[]>,
  device: Device,
): void {
  const name = tokens[1];
  const kw = tokens[2];
  if (!name) {
    device.unparsedLines.push({ lineNo, text: raw });
    return;
  }
  if (kw === 'remark') {
    const list = pendingRemark.get(name) ?? [];
    list.push(tokens.slice(3).join(' '));
    pendingRemark.set(name, list);
    return;
  }
  if (kw === 'extended' || kw === 'standard') {
    const type: AclType = kw === 'standard' ? 'standard' : 'extended';
    const acl = getOrCreateAcl(name, type, lineNo);
    const rule = parseAsaAce(tokens, 3, type, lineNo);
    if (rule) {
      const rem = pendingRemark.get(name);
      if (rem && rem.length > 0) {
        rule.remark = rem;
        pendingRemark.delete(name);
      }
      acl.rules.push(rule);
      return;
    }
  }
  device.unparsedLines.push({ lineNo, text: raw });
}
