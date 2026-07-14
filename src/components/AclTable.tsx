import { useMemo, useState } from 'react';
import type { Acl, AddressSpec, AclRule, Device, ObjectGroup, PortSpec } from '../types/ir';
import { formatAddress, formatPort, isAny } from '../utils/format';
import { ruleMatchesIp } from '../analysis/references';
import { buildGroupIndex, expandNetworkGroup, expandServiceGroup } from '../analysis/expand';
import { ipToInt } from '../utils/ip';
import { useApp } from '../state/AppContext';

type GroupIndex = Map<string, ObjectGroup>;

/** V2 ACL テーブル。正規化されたルール表でレビューを支援する(基本設計 §4.2 V2)。 */
export function AclTable({ device }: { device: Device }) {
  const { dispatch } = useApp();
  const [selectedAcl, setSelectedAcl] = useState<string>(device.acls[0]?.name ?? '');
  const [actionFilter, setActionFilter] = useState<'all' | 'permit' | 'deny'>('all');
  const [protoFilter, setProtoFilter] = useState('');
  const [ipFilter, setIpFilter] = useState('');
  const [textFilter, setTextFilter] = useState('');
  const [expand, setExpand] = useState(false);

  const groupIndex = useMemo(() => buildGroupIndex(device), [device]);
  const hasGroups = device.objectGroups.length > 0;

  const acl = useMemo(
    () => device.acls.find((a) => a.name === selectedAcl) ?? device.acls[0] ?? null,
    [device.acls, selectedAcl],
  );

  const filtered = useMemo(() => {
    if (!acl) return [];
    const ipValid = ipFilter.trim() !== '' && ipToInt(ipFilter.trim()) !== null;
    const text = textFilter.trim().toLowerCase();
    const proto = protoFilter.trim().toLowerCase();
    return acl.rules.filter((rule) => {
      if (actionFilter !== 'all' && rule.action !== actionFilter) return false;
      if (proto && rule.protocol.toLowerCase() !== proto) return false;
      if (ipValid && !ruleMatchesIp(rule, ipFilter.trim())) return false;
      if (text && !ruleToText(rule).toLowerCase().includes(text)) return false;
      return true;
    });
  }, [acl, actionFilter, protoFilter, ipFilter, textFilter]);

  if (device.acls.length === 0) {
    return <div className="p-6 text-sm text-slate-500">ACL が見つかりませんでした。</div>;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      {/* ツールバー */}
      <div className="flex flex-wrap items-center gap-3 no-print">
        <select
          value={acl?.name ?? ''}
          onChange={(e) => setSelectedAcl(e.target.value)}
          className="rounded border border-slate-300 px-2 py-1 text-sm font-mono"
        >
          {device.acls.map((a) => (
            <option key={a.name} value={a.name}>
              {a.name}({a.type}, {a.rules.length})
            </option>
          ))}
        </select>
        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value as 'all' | 'permit' | 'deny')}
          className="rounded border border-slate-300 px-2 py-1 text-sm"
        >
          <option value="all">action: すべて</option>
          <option value="permit">permit</option>
          <option value="deny">deny</option>
        </select>
        <input
          value={protoFilter}
          onChange={(e) => setProtoFilter(e.target.value)}
          placeholder="protocol"
          className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
        />
        <input
          value={ipFilter}
          onChange={(e) => setIpFilter(e.target.value)}
          placeholder="IP 含有 (例 10.1.2.3)"
          className="w-40 rounded border border-slate-300 px-2 py-1 text-sm font-mono"
        />
        <input
          value={textFilter}
          onChange={(e) => setTextFilter(e.target.value)}
          placeholder="フリーテキスト"
          className="w-40 rounded border border-slate-300 px-2 py-1 text-sm"
        />
        <label
          className={`flex items-center gap-1 text-sm ${hasGroups ? 'text-slate-700' : 'text-slate-300'}`}
          title={hasGroups ? undefined : 'object-group / object の定義がありません'}
        >
          <input
            type="checkbox"
            checked={expand}
            disabled={!hasGroups}
            onChange={(e) => setExpand(e.target.checked)}
          />
          object-group 展開
        </label>
        <span className="text-xs text-slate-500">
          {filtered.length} / {acl?.rules.length ?? 0} ルール
        </span>
      </div>

      {/* ルール表 */}
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-slate-300 text-left text-slate-600">
              <Th>#</Th>
              <Th>action</Th>
              <Th>proto</Th>
              <Th>src</Th>
              <Th>src-port</Th>
              <Th>dst</Th>
              <Th>dst-port</Th>
              <Th>options</Th>
              <Th>remark</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((rule, i) => (
              <RuleRow
                key={`${rule.sourceLineNo}-${i}`}
                rule={rule}
                expand={expand}
                index={groupIndex}
                onJump={() => dispatch({ type: 'JUMP_TO_LINE', lineNo: rule.sourceLineNo })}
              />
            ))}
            {/* 末尾の暗黙 deny を常時表示(基本設計 §4.2 V4)。 */}
            <tr className="bg-slate-50 text-slate-500">
              <Td>—</Td>
              <Td>(implicit)</Td>
              <Td colSpan={7}>deny ip any any(暗黙。ログなし)</Td>
            </tr>
          </tbody>
        </table>
      </div>
      {acl && <ImplicitNote acl={acl} />}
    </div>
  );
}

function RuleRow({
  rule,
  expand,
  index,
  onJump,
}: {
  rule: AclRule;
  expand: boolean;
  index: GroupIndex;
  onJump: () => void;
}) {
  const permit = rule.action === 'permit';
  const opts: string[] = [];
  if (rule.options.log) opts.push('log');
  if (rule.options.established) opts.push('established');
  if (rule.options.extra) opts.push(...rule.options.extra);

  return (
    <tr
      className="cursor-pointer border-b border-slate-100 hover:bg-sky-50"
      onClick={onJump}
      title="クリックで原文の該当行へ"
    >
      <Td>{rule.seq ?? ''}</Td>
      <Td>
        <span
          className={`rounded px-1.5 py-0.5 text-xs font-semibold ${
            permit ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
          }`}
        >
          {rule.action.toUpperCase()}
        </span>
      </Td>
      <Td mono>{rule.protocol}</Td>
      <AddressCell spec={rule.src} expand={expand} index={index} />
      <PortCell spec={rule.srcPort} expand={expand} index={index} />
      <AddressCell spec={rule.dst} expand={expand} index={index} />
      <PortCell spec={rule.dstPort} expand={expand} index={index} />
      <Td mono>{opts.join(' ')}</Td>
      <Td>
        {rule.remark && rule.remark.length > 0 ? (
          <span className="text-xs italic text-slate-500">{rule.remark.join(' / ')}</span>
        ) : (
          ''
        )}
      </Td>
    </tr>
  );
}

function ImplicitNote({ acl }: { acl: Acl }) {
  const lastLog = acl.rules.length > 0 && acl.rules[acl.rules.length - 1]!.options.log;
  return (
    <p className="text-xs text-slate-500">
      末尾に暗黙の deny ip any any が存在します。
      {lastLog ? '最終ルールに log があります。' : '拒否ログを取得したい場合は明示的な deny + log を検討してください。'}
    </p>
  );
}

/** アドレス列。展開 ON かつ object-group 参照なら実アドレスを列挙する。 */
function AddressCell({
  spec,
  expand,
  index,
}: {
  spec: AddressSpec;
  expand: boolean;
  index: GroupIndex;
}) {
  if (isAny(spec)) {
    return (
      <td className="px-3 py-1.5 align-top font-mono text-xs">
        <span className="rounded bg-amber-100 px-1 font-semibold text-amber-800">any ⚠</span>
      </td>
    );
  }
  if (expand && spec.kind === 'objectGroup') {
    const res = expandNetworkGroup(spec.name, index);
    return (
      <td className="px-3 py-1.5 align-top font-mono text-xs">
        <ExpandedGroup name={spec.name} members={res.members} missing={res.missing} cyclic={res.cyclic} />
      </td>
    );
  }
  return <td className="px-3 py-1.5 align-top font-mono text-xs">{formatAddress(spec)}</td>;
}

/** ポート列。展開 ON かつ service object-group 参照なら実ポートを列挙する。 */
function PortCell({
  spec,
  expand,
  index,
}: {
  spec: PortSpec | undefined;
  expand: boolean;
  index: GroupIndex;
}) {
  if (expand && spec && spec.op === 'objectGroup') {
    const res = expandServiceGroup(spec.name, index);
    return (
      <td className="px-3 py-1.5 align-top font-mono text-xs">
        <ExpandedGroup name={spec.name} members={res.members} missing={res.missing} cyclic={res.cyclic} />
      </td>
    );
  }
  return <td className="px-3 py-1.5 align-top font-mono text-xs">{formatPort(spec)}</td>;
}

/** 展開結果(グループ名 + メンバ一覧 + 未定義/循環の注記)を表示する。 */
function ExpandedGroup({
  name,
  members,
  missing,
  cyclic,
}: {
  name: string;
  members: string[];
  missing: string[];
  cyclic: boolean;
}) {
  const undefinedSelf = missing.includes(name) && members.length === 0;
  return (
    <div>
      <div className="text-slate-500">
        OG:{name}
        {undefinedSelf && <span className="ml-1 font-semibold text-red-600">(未定義)</span>}
      </div>
      {members.length > 0 && (
        <ul className="mt-0.5 space-y-0.5">
          {members.map((m, i) => (
            <li key={i} className="text-slate-800">
              ↳ {m}
            </li>
          ))}
        </ul>
      )}
      {!undefinedSelf && missing.length > 0 && (
        <div className="text-red-600">未定義: {missing.join(', ')}</div>
      )}
      {cyclic && <div className="text-red-600">循環参照を検出</div>}
    </div>
  );
}

function ruleToText(rule: AclRule): string {
  return [
    rule.seq ?? '',
    rule.action,
    rule.protocol,
    formatAddress(rule.src),
    formatPort(rule.srcPort),
    formatAddress(rule.dst),
    formatPort(rule.dstPort),
    rule.options.log ? 'log' : '',
    rule.options.established ? 'established' : '',
    ...(rule.options.extra ?? []),
    ...(rule.remark ?? []),
  ].join(' ');
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="whitespace-nowrap px-3 py-2 font-medium">{children}</th>;
}

function Td({
  children,
  mono,
  colSpan,
}: {
  children: React.ReactNode;
  mono?: boolean;
  colSpan?: number;
}) {
  return (
    <td colSpan={colSpan} className={`px-3 py-1.5 align-top ${mono ? 'font-mono text-xs' : ''}`}>
      {children}
    </td>
  );
}
