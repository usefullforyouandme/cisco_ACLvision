import type { Device, OsType } from '../types/ir';
import { detectOs } from './detectOs';
import { parseIos } from './ios';
import { parseAsa } from './asa';

let deviceSeq = 0;

/** テスト時などに ID 採番をリセットする。 */
export function resetDeviceSeq(): void {
  deviceSeq = 0;
}

export interface ParseOptions {
  /** OS 自動判定を上書きする。 */
  forcedOs?: OsType;
  sourceName?: string;
  /** 装置 ID を明示指定(未指定なら連番採番)。 */
  id?: string;
}

/**
 * 設定テキストを IR(Device)へ変換するエントリポイント。
 * OS を判定し、対応パーサ(IOS / ASA)へ委譲する。
 */
export function parseConfig(text: string, opts: ParseOptions = {}): Device {
  const rawLines = text.split(/\r?\n/);
  const os = opts.forcedOs ?? detectOs(text);
  const id = opts.id ?? `dev-${++deviceSeq}`;

  if (os === 'asa') {
    return parseAsa(rawLines, id, opts.sourceName);
  }
  return parseIos(rawLines, id, opts.sourceName);
}
