import { useEffect, useRef } from 'react';
import type { Device } from '../types/ir';
import { useApp } from '../state/AppContext';

/** 原文ビュー。行番号付きで show run を表示し、指定行をハイライト・スクロールする。 */
export function RawView({ device }: { device: Device }) {
  const { state } = useApp();
  const highlight = state.highlightLineNo;
  const activeRef = useRef<HTMLDivElement>(null);
  const unparsedSet = new Set(device.unparsedLines.map((u) => u.lineNo));

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlight]);

  return (
    <div className="mx-auto max-w-6xl p-6">
      <p className="mb-2 text-xs text-slate-500">
        黄色 = 未解析行 / 水色 = 選択中の行。ACL・サマリの行クリックでここへジャンプします。
      </p>
      <div className="overflow-x-auto rounded border border-slate-200 bg-slate-50 font-mono text-xs">
        {device.rawLines.map((line, i) => {
          const lineNo = i + 1;
          const isHighlight = highlight === lineNo;
          const isUnparsed = unparsedSet.has(lineNo);
          return (
            <div
              key={lineNo}
              ref={isHighlight ? activeRef : undefined}
              className={`flex whitespace-pre ${
                isHighlight ? 'bg-sky-200' : isUnparsed ? 'bg-amber-50' : ''
              }`}
            >
              <span className="w-12 flex-shrink-0 select-none border-r border-slate-200 px-2 text-right text-slate-400">
                {lineNo}
              </span>
              <span className="px-2 text-slate-800">{line || ' '}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
