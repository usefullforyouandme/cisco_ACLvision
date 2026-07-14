import { useApp, type ViewId } from './state/AppContext';
import { InputPanel } from './components/InputPanel';
import { DeviceSummary } from './components/DeviceSummary';
import { AclTable } from './components/AclTable';
import { ApplicationMap } from './components/ApplicationMap';
import { ReviewPanel } from './components/ReviewPanel';
import { RawView } from './components/RawView';

const VIEWS: { id: ViewId; label: string }[] = [
  { id: 'summary', label: 'サマリ' },
  { id: 'acl', label: 'ACL' },
  { id: 'map', label: '適用マップ' },
  { id: 'review', label: 'レビュー' },
  { id: 'raw', label: '原文' },
];

export function App() {
  const { state, dispatch, activeDevice } = useApp();
  const hasData = state.devices.length > 0;

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white shadow-sm no-print">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-2">
          <span className="text-lg font-bold text-sky-700">ACLvision</span>

          {hasData && (
            <>
              <select
                value={state.activeDeviceId ?? ''}
                onChange={(e) => dispatch({ type: 'SET_ACTIVE_DEVICE', id: e.target.value })}
                className="rounded border border-slate-300 px-2 py-1 text-sm"
              >
                {state.devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.hostname}
                    {d.sourceName ? ` (${d.sourceName})` : ''}
                  </option>
                ))}
              </select>

              <nav className="flex gap-1">
                {VIEWS.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => dispatch({ type: 'SET_VIEW', view: v.id })}
                    className={`rounded px-3 py-1 text-sm ${
                      state.activeView === v.id
                        ? 'bg-sky-600 text-white'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {v.label}
                  </button>
                ))}
              </nav>

              <button
                onClick={() => dispatch({ type: 'CLEAR_ALL' })}
                className="ml-auto rounded border border-red-300 px-3 py-1 text-sm text-red-700 hover:bg-red-50"
              >
                データ消去
              </button>
            </>
          )}
        </div>
      </header>

      <main>
        {!hasData || !activeDevice ? (
          <InputPanel />
        ) : state.activeView === 'summary' ? (
          <DeviceSummary device={activeDevice} />
        ) : state.activeView === 'acl' ? (
          <AclTable device={activeDevice} />
        ) : state.activeView === 'map' ? (
          <ApplicationMap device={activeDevice} />
        ) : state.activeView === 'review' ? (
          <ReviewPanel device={activeDevice} />
        ) : (
          <RawView device={activeDevice} />
        )}
      </main>
    </div>
  );
}
