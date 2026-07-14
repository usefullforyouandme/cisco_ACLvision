// ACLvision 共通中間モデル(IR)
// 各 OS のパーサはこのモデルへ変換し、表示・分析層は IR のみに依存する(基本設計 §3.4)。
// v1 は IPv4 のみ対象。IPv6 は将来 AddressSpec に kind を追加して拡張可能な形にしてある。

export type OsType = 'ios' | 'asa';

/** アドレス指定。object-group は展開せず参照のまま保持する(展開は Phase 3)。 */
export type AddressSpec =
  | { kind: 'any' }
  | { kind: 'host'; ip: string }
  | { kind: 'subnet'; addr: string; wildcard: string } // wildcard は逆マスク(IOS 標準)
  | { kind: 'objectGroup'; name: string }
  | { kind: 'raw'; text: string }; // 解析しきれなかったアドレス表現の原文保持

/** ポート指定(TCP/UDP)。 */
export type PortSpec =
  | { op: 'eq' | 'gt' | 'lt' | 'neq'; port: string }
  | { op: 'range'; from: string; to: string }
  | { op: 'objectGroup'; name: string };

export interface AclRuleOptions {
  log?: boolean;
  established?: boolean;
  /** 上記以外に付随したトークン(dscp, time-range 等)を原文のまま保持する。 */
  extra?: string[];
}

export interface AclRule {
  /** シーケンス番号(named ACL で明示されている場合のみ)。 */
  seq?: number;
  action: 'permit' | 'deny';
  protocol: string; // ip / tcp / udp / icmp / <number> など
  src: AddressSpec;
  srcPort?: PortSpec;
  dst: AddressSpec;
  dstPort?: PortSpec;
  options: AclRuleOptions;
  /** 直前に並んでいた remark 行(複数可)。 */
  remark?: string[];
  /** このルールが由来する原文の行番号(1 始まり)。 */
  sourceLineNo: number;
}

export type AclType = 'standard' | 'extended';

export interface Acl {
  /** named ACL の名前、または numbered ACL の番号を文字列化したもの。表示・参照の一意キー。 */
  name: string;
  /** numbered ACL の場合の番号。 */
  number?: number;
  type: AclType;
  rules: AclRule[];
  /** ACL 定義が最初に現れた原文の行番号。 */
  sourceLineNo: number;
}

/** ACL の適用箇所。 */
export interface AclBinding {
  aclName: string;
  /** 適用の種類。 */
  kind: 'interface' | 'line' | 'snmp' | 'other';
  /** 適用先の識別子(インターフェース名、line 名、snmp community 名など)。 */
  target: string;
  /** in / out(方向を持つ適用のみ)。 */
  direction?: 'in' | 'out';
  sourceLineNo: number;
}

export interface Interface {
  name: string;
  ip?: string; // "10.0.0.1 255.255.255.0" など原文寄りの表現
  vlan?: string;
  description?: string;
  /** ASA の nameif(outside / inside 等)。IOS では未設定。access-group はこの名前で適用される。 */
  nameif?: string;
  shutdown: boolean;
  /** このインターフェースに適用された ACL(in/out)。 */
  aclBindings: AclBinding[];
  sourceLineNo: number;
}

export type ObjectGroupType = 'network' | 'service' | 'protocol' | 'other';

export interface ObjectGroup {
  name: string;
  type: ObjectGroupType;
  /** メンバ行を原文のまま保持。展開(analysis/expand.ts)はこの行を解釈する。 */
  lines: string[];
  /** ASA の "object network|service"(単一オブジェクト)由来なら true。"object-group" なら false。 */
  isObject?: boolean;
  sourceLineNo: number;
}

/** 管理系サービスの俯瞰情報。 */
export interface ServiceSummary {
  ssh?: boolean;
  telnet?: boolean;
  httpServer?: boolean;
  httpsServer?: boolean;
  snmp?: boolean;
  /** vty 回線に適用された access-class の ACL 名。 */
  vtyAccessClass?: string[];
}

export interface UnparsedLine {
  lineNo: number;
  text: string;
}

export interface Device {
  /** 装置を一意に識別する ID(読込順に採番、UI のタブ切替キー)。 */
  id: string;
  /** 元ファイル名(ファイル読込時)。貼り付け時は未設定。 */
  sourceName?: string;
  hostname: string;
  os: OsType;
  /** OS が未対応(Phase 1 では ASA)の場合 true。この場合パースは最小限。 */
  osSupported: boolean;
  version?: string;
  rawLines: string[];
  interfaces: Interface[];
  acls: Acl[];
  /** interface 以外を含む全 ACL 適用箇所(参照解決・未使用判定に使う)。 */
  bindings: AclBinding[];
  objectGroups: ObjectGroup[];
  services: ServiceSummary;
  unparsedLines: UnparsedLine[];
}
