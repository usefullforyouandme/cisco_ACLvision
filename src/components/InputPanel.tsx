import { useRef, useState, type DragEvent } from 'react';
import { parseConfig } from '../parser';
import type { OsType } from '../types/ir';
import { useApp } from '../state/AppContext';

type OsChoice = 'auto' | OsType;

/**
 * 入力画面。テキスト貼り付け / ファイル読込(D&D・選択、複数可)/ OS 手動切替に対応する。
 * 読み込んだデータはメモリ上のみで保持し、外部送信は行わない(基本設計 §4.1 / §8.1)。
 */
export function InputPanel() {
  const { dispatch } = useApp();
  const [text, setText] = useState('');
  const [osChoice, setOsChoice] = useState<OsChoice>('auto');
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const forcedOs = osChoice === 'auto' ? undefined : osChoice;

  const loadFromText = () => {
    if (text.trim().length === 0) return;
    const device = parseConfig(text, { forcedOs });
    dispatch({ type: 'LOAD', devices: [device] });
    setText('');
  };

  const loadFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    const devices = await Promise.all(
      arr.map(async (file) => {
        const content = await file.text();
        return parseConfig(content, { forcedOs, sourceName: file.name });
      }),
    );
    if (devices.length > 0) dispatch({ type: 'LOAD', devices });
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length > 0) void loadFiles(e.dataTransfer.files);
  };

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
        設定データはブラウザ内でのみ処理され、外部へ送信されません。リロードするとデータは消去されます。
      </div>

      <div className="mb-3 flex items-center gap-3">
        <label className="text-sm font-medium text-slate-700">OS:</label>
        <select
          value={osChoice}
          onChange={(e) => setOsChoice(e.target.value as OsChoice)}
          className="rounded border border-slate-300 px-2 py-1 text-sm"
        >
          <option value="auto">自動判定</option>
          <option value="ios">IOS / IOS-XE</option>
          <option value="asa">ASA(Phase 3 で対応予定)</option>
        </select>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`rounded-md border-2 border-dashed p-1 transition-colors ${
          dragging ? 'border-sky-400 bg-sky-50' : 'border-slate-300'
        }`}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="show running-config の全体または ACL 部分を貼り付け、またはファイルをドラッグ&ドロップ"
          spellCheck={false}
          className="h-72 w-full resize-y rounded bg-white p-3 font-mono text-xs text-slate-800 outline-none"
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          onClick={loadFromText}
          disabled={text.trim().length === 0}
          className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          解析する
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          ファイルを選択
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void loadFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
