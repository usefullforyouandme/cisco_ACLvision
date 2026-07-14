import { useMemo } from 'react';
import type { Device } from '../types/ir';
import { analyzeReferences, countOverlyPermissive, isOverlyPermissive } from '../analysis/references';
import { useApp } from '../state/AppContext';

/** V1 装置サマリ(俯瞰)。ホスト名・interface・ACL 一覧・管理サービス・統計を表示する。 */
export function DeviceSummary({ device }: { device: Device }) {
  const { dispatch } = useApp();
  const refReport = useMemo(() => analyzeReferences(device), [device]);

  const stats = useMemo(() => {
    let permit = 0;
    let deny = 0;
    for (const acl of device.acls) {
      for (const rule of acl.rules) {
        if (rule.action === 'permit') permit++;
        else deny++;
      }
    }
    return { permit, deny, overly: countOverlyPermissive(device) };
  }, [device]);

  const bindingCount = (aclName: string) =>
    device.bindings.filter((b) => b.aclName === aclName).length;

  if (!device.osSupported) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          この装置の OS(<span className="font-mono">{device.os}</span>)は Phase 1 では未対応です。
          原文ビューで内容を確認できます。
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      {/* 装置基本情報 */}
      <section>
        <h2 className="mb-2 text-lg font-semibold text-slate-800">装置情報</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <Info label="ホスト名" value={device.hostname} />
          <Info label="OS" value={device.os.toUpperCase()} />
          <Info label="バージョン" value={device.version ?? '—'} />
          <Info label="ファイル" value={device.sourceName ?? '(貼り付け)'} />
        </dl>
      </section>

      {/* 統計 */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="ACL 数" value={device.acls.length} />
        <Stat label="permit / deny" value={`${stats.permit} / ${stats.deny}`} />
        <Stat
          label="permit ip any any"
          value={stats.overly}
          warn={stats.overly > 0}
        />
        <Stat label="未使用 ACL" value={refReport.unusedAcls.length} warn={refReport.unusedAcls.length > 0} />
      </section>

      {(refReport.undefinedAcls.length > 0 || refReport.unusedAcls.length > 0) && (
        <section className="space-y-2 text-sm">
          {refReport.undefinedAcls.length > 0 && (
            <div className="rounded border border-red-300 bg-red-50 p-3 text-red-900">
              未定義参照(適用されているが定義がない ACL): {refReport.undefinedAcls.join(', ')}
            </div>
          )}
          {refReport.unusedAcls.length > 0 && (
            <div className="rounded border border-amber-300 bg-amber-50 p-3 text-amber-900">
              未使用 ACL(定義されているが未適用): {refReport.unusedAcls.join(', ')}
            </div>
          )}
        </section>
      )}

      {/* インターフェース一覧 */}
      <section>
        <h2 className="mb-2 text-lg font-semibold text-slate-800">
          インターフェース({device.interfaces.length})
        </h2>
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-300 text-left text-slate-600">
                <Th>名前</Th>
                <Th>IP アドレス</Th>
                <Th>VLAN</Th>
                <Th>状態</Th>
                <Th>適用 ACL</Th>
                <Th>description</Th>
              </tr>
            </thead>
            <tbody>
              {device.interfaces.map((iface) => (
                <tr key={iface.name} className="border-b border-slate-100">
                  <Td mono>{iface.name}</Td>
                  <Td mono>{iface.ip ?? '—'}</Td>
                  <Td>{iface.vlan ?? '—'}</Td>
                  <Td>
                    {iface.shutdown ? (
                      <span className="text-red-600">shutdown</span>
                    ) : (
                      <span className="text-emerald-600">up</span>
                    )}
                  </Td>
                  <Td mono>
                    {iface.aclBindings.length === 0
                      ? '—'
                      : iface.aclBindings.map((b) => `${b.aclName}(${b.direction ?? '?'})`).join(', ')}
                  </Td>
                  <Td>{iface.description ?? '—'}</Td>
                </tr>
              ))}
              {device.interfaces.length === 0 && (
                <tr>
                  <Td>—</Td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ACL 一覧 */}
      <section>
        <h2 className="mb-2 text-lg font-semibold text-slate-800">ACL 一覧({device.acls.length})</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-300 text-left text-slate-600">
                <Th>名前 / 番号</Th>
                <Th>種別</Th>
                <Th>ルール数</Th>
                <Th>適用箇所数</Th>
                <Th>要注意</Th>
              </tr>
            </thead>
            <tbody>
              {device.acls.map((acl) => {
                const overly = acl.rules.filter(isOverlyPermissive).length;
                return (
                  <tr
                    key={acl.name}
                    className="cursor-pointer border-b border-slate-100 hover:bg-sky-50"
                    onClick={() => dispatch({ type: 'JUMP_TO_LINE', lineNo: acl.sourceLineNo })}
                  >
                    <Td mono>{acl.name}</Td>
                    <Td>{acl.type}</Td>
                    <Td>{acl.rules.length}</Td>
                    <Td>{bindingCount(acl.name)}</Td>
                    <Td>{overly > 0 ? <span className="text-red-600">any×{overly}</span> : '—'}</Td>
                  </tr>
                );
              })}
              {device.acls.length === 0 && (
                <tr>
                  <Td>ACL が見つかりませんでした</Td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 管理サービス */}
      <section>
        <h2 className="mb-2 text-lg font-semibold text-slate-800">管理サービス</h2>
        <div className="flex flex-wrap gap-2 text-sm">
          <ServiceBadge label="SSH" on={device.services.ssh} />
          <ServiceBadge label="Telnet" on={device.services.telnet} danger />
          <ServiceBadge label="HTTP" on={device.services.httpServer} danger />
          <ServiceBadge label="HTTPS" on={device.services.httpsServer} />
          <ServiceBadge label="SNMP" on={device.services.snmp} />
          {device.services.vtyAccessClass && device.services.vtyAccessClass.length > 0 && (
            <span className="rounded bg-slate-100 px-2 py-1 text-slate-700">
              vty access-class: {device.services.vtyAccessClass.join(', ')}
            </span>
          )}
        </div>
      </section>

      {device.unparsedLines.length > 0 && (
        <p className="text-xs text-slate-500">
          未解析行: {device.unparsedLines.length} 行(原文ビューで確認できます)
        </p>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-800">{value}</dd>
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <div className={`rounded-md border p-3 ${warn ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'}`}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-xl font-semibold ${warn ? 'text-red-700' : 'text-slate-800'}`}>{value}</div>
    </div>
  );
}

function ServiceBadge({ label, on, danger }: { label: string; on?: boolean; danger?: boolean }) {
  if (!on) {
    return <span className="rounded bg-slate-100 px-2 py-1 text-slate-400">{label}: off</span>;
  }
  return (
    <span
      className={`rounded px-2 py-1 font-medium ${
        danger ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
      }`}
    >
      {label}: on
    </span>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="whitespace-nowrap px-3 py-2 font-medium">{children}</th>;
}

function Td({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return <td className={`px-3 py-1.5 align-top ${mono ? 'font-mono text-xs' : ''}`}>{children}</td>;
}
