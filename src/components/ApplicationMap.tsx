import { useMemo } from 'react';
import type { Device } from '../types/ir';
import { useApp } from '../state/AppContext';

/**
 * V3 適用マップ。ACL の適用元(interface / line / snmp)と ACL を二部グラフの SVG で描画する。
 * 適用元からは「何が適用されているか」、ACL からは「どこに適用されているか」を相互に辿れる。
 * 未使用 ACL・未定義参照は色で警告する(基本設計 §4.2 V3)。
 */
export function ApplicationMap({ device }: { device: Device }) {
  const { dispatch } = useApp();

  const layout = useMemo(() => buildLayout(device), [device]);

  if (!device.osSupported) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          この装置の OS は Phase 1 では未対応のため、適用マップを表示できません。
        </div>
      </div>
    );
  }

  if (layout.sources.length === 0 && layout.acls.length === 0) {
    return <div className="p-6 text-sm text-slate-500">ACL の適用関係が見つかりませんでした。</div>;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-3 p-6">
      <Legend />
      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <svg
          viewBox={`0 0 ${VIEW_W} ${layout.height}`}
          width="100%"
          role="img"
          aria-label="ACL 適用マップ"
          className="min-w-[640px]"
        >
          {/* エッジ(適用関係) */}
          {layout.edges.map((e, i) => (
            <g key={i}>
              <path d={e.path} fill="none" stroke="#94a3b8" strokeWidth={1.5} />
              {e.direction && (
                <text
                  x={e.labelX}
                  y={e.labelY}
                  textAnchor="middle"
                  className="fill-slate-500"
                  fontSize={11}
                >
                  {e.direction}
                </text>
              )}
            </g>
          ))}

          {/* 適用元ノード(左) */}
          {layout.sources.map((s) => (
            <Node
              key={s.key}
              x={LEFT_X}
              y={s.y}
              width={NODE_W}
              label={s.target}
              sub={s.kindLabel}
              variant={SOURCE_VARIANT[s.kind] ?? 'other'}
              onClick={s.sourceLineNo ? () => dispatch({ type: 'JUMP_TO_LINE', lineNo: s.sourceLineNo! }) : undefined}
            />
          ))}

          {/* ACL ノード(右) */}
          {layout.acls.map((a) => (
            <Node
              key={a.name}
              x={RIGHT_X}
              y={a.y}
              width={NODE_W}
              label={a.name}
              sub={!a.defined ? '未定義' : !a.used ? '未使用' : 'ACL'}
              variant={!a.defined ? 'undefined' : !a.used ? 'unused' : 'acl'}
              onClick={a.sourceLineNo ? () => dispatch({ type: 'JUMP_TO_LINE', lineNo: a.sourceLineNo! }) : undefined}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}

// --- レイアウト定数(viewBox 座標系) ---
const VIEW_W = 760;
const NODE_W = 210;
const NODE_H = 38;
const ROW_H = 58;
const PAD_TOP = 24;
const LEFT_X = 24;
const RIGHT_X = VIEW_W - NODE_W - 24;

type SourceVariant = 'interface' | 'line' | 'snmp' | 'other';
type NodeVariant = SourceVariant | 'acl' | 'unused' | 'undefined';

const SOURCE_VARIANT: Record<string, SourceVariant> = {
  interface: 'interface',
  line: 'line',
  snmp: 'snmp',
  other: 'other',
};

const KIND_LABEL: Record<string, string> = {
  interface: 'interface',
  line: 'line',
  snmp: 'snmp-server',
  other: 'その他',
};

interface LayoutSource {
  key: string;
  kind: string;
  kindLabel: string;
  target: string;
  y: number;
  sourceLineNo?: number;
}
interface LayoutAcl {
  name: string;
  defined: boolean;
  used: boolean;
  y: number;
  sourceLineNo?: number;
}
interface LayoutEdge {
  path: string;
  direction?: 'in' | 'out';
  labelX: number;
  labelY: number;
}

function buildLayout(device: Device) {
  // 適用元ノードを (kind, target) で一意化。
  const sourceMap = new Map<string, LayoutSource>();
  for (const b of device.bindings) {
    const key = `${b.kind}:${b.target}`;
    if (!sourceMap.has(key)) {
      sourceMap.set(key, {
        key,
        kind: b.kind,
        kindLabel: KIND_LABEL[b.kind] ?? b.kind,
        target: b.target,
        y: 0,
        sourceLineNo: b.sourceLineNo,
      });
    }
  }
  const sources = [...sourceMap.values()];

  // ACL ノード = 定義済み ACL + 未定義参照名。
  const definedNames = new Set(device.acls.map((a) => a.name));
  const boundNames = new Set(device.bindings.map((b) => b.aclName));
  const aclList: LayoutAcl[] = device.acls.map((a) => ({
    name: a.name,
    defined: true,
    used: boundNames.has(a.name),
    y: 0,
    sourceLineNo: a.sourceLineNo,
  }));
  for (const name of boundNames) {
    if (!definedNames.has(name)) {
      const b = device.bindings.find((x) => x.aclName === name);
      aclList.push({ name, defined: false, used: true, y: 0, sourceLineNo: b?.sourceLineNo });
    }
  }

  // 縦位置を採番。
  sources.forEach((s, i) => (s.y = PAD_TOP + i * ROW_H));
  aclList.forEach((a, i) => (a.y = PAD_TOP + i * ROW_H));

  const rows = Math.max(sources.length, aclList.length, 1);
  const height = PAD_TOP * 2 + rows * ROW_H - (ROW_H - NODE_H);

  // エッジ = binding。適用元ノードと ACL ノードを結ぶ。
  const yOf = (arr: { key?: string; name?: string; y: number }[], match: (n: any) => boolean) =>
    arr.find(match)?.y;
  const edges: LayoutEdge[] = [];
  for (const b of device.bindings) {
    const sKey = `${b.kind}:${b.target}`;
    const sy = yOf(sources, (n) => n.key === sKey);
    const ay = yOf(aclList, (n) => n.name === b.aclName);
    if (sy === undefined || ay === undefined) continue;
    const x1 = LEFT_X + NODE_W;
    const y1 = sy + NODE_H / 2;
    const x2 = RIGHT_X;
    const y2 = ay + NODE_H / 2;
    const midX = (x1 + x2) / 2;
    edges.push({
      path: `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`,
      direction: b.direction,
      labelX: x1 + 24,
      labelY: y1 - 4,
    });
  }

  return { sources, acls: aclList, edges, height };
}

// --- 描画部品 ---
const VARIANT_STYLE: Record<NodeVariant, { fill: string; stroke: string; text: string; dash?: string }> = {
  interface: { fill: '#e0f2fe', stroke: '#38bdf8', text: '#075985' },
  line: { fill: '#ede9fe', stroke: '#a78bfa', text: '#5b21b6' },
  snmp: { fill: '#f1f5f9', stroke: '#94a3b8', text: '#334155' },
  other: { fill: '#f1f5f9', stroke: '#94a3b8', text: '#334155' },
  acl: { fill: '#ffffff', stroke: '#cbd5e1', text: '#1e293b' },
  unused: { fill: '#fffbeb', stroke: '#fbbf24', text: '#92400e' },
  undefined: { fill: '#fef2f2', stroke: '#f87171', text: '#991b1b', dash: '5 3' },
};

function Node({
  x,
  y,
  width,
  label,
  sub,
  variant,
  onClick,
}: {
  x: number;
  y: number;
  width: number;
  label: string;
  sub: string;
  variant: NodeVariant;
  onClick?: () => void;
}) {
  const s = VARIANT_STYLE[variant];
  return (
    <g
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : 'default' }}
      className={onClick ? 'hover:opacity-80' : undefined}
    >
      <rect
        x={x}
        y={y}
        width={width}
        height={NODE_H}
        rx={6}
        fill={s.fill}
        stroke={s.stroke}
        strokeWidth={1.5}
        strokeDasharray={s.dash}
      />
      <text x={x + 10} y={y + 16} fontSize={13} fontWeight={600} fill={s.text} className="font-mono">
        {truncate(label, 26)}
      </text>
      <text x={x + 10} y={y + 30} fontSize={10} fill={s.text} opacity={0.7}>
        {sub}
      </text>
    </g>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-3 text-xs text-slate-600">
      <LegendItem color="#38bdf8" label="interface" />
      <LegendItem color="#a78bfa" label="line(vty)" />
      <LegendItem color="#94a3b8" label="snmp / その他" />
      <LegendItem color="#fbbf24" label="未使用 ACL" />
      <LegendItem color="#f87171" label="未定義参照(点線)" />
      <span className="text-slate-400">ノードクリックで原文へジャンプ</span>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="inline-block h-3 w-3 rounded" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}
