import type { OsType } from '../types/ir';

/**
 * 設定テキストから OS を推定する。誤判定に備え UI で手動上書き可能(基本設計 §3.3)。
 * ASA 特有の構文を優先的に検出し、なければ IOS とみなす。
 */
export function detectOs(text: string): OsType {
  const lines = text.split(/\r?\n/);
  let asaScore = 0;
  let iosScore = 0;

  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('ASA Version')) asaScore += 5;
    if (t.startsWith('PIX Version')) asaScore += 5;
    // ASA: access-list NAME extended permit ... / access-list NAME remark ...
    if (/^access-list\s+\S+\s+(extended|remark|standard)\b/.test(t)) asaScore += 2;
    if (/^access-group\s+\S+\s+(in|out)\s+interface\b/.test(t)) asaScore += 3;
    if (/^object\s+(network|service)\b/.test(t)) asaScore += 2;
    if (/^names\b/.test(t)) asaScore += 1;

    // IOS: ip access-list standard|extended NAME / access-list <num> ...
    if (/^ip access-list\s+(standard|extended)\b/.test(t)) iosScore += 3;
    if (/^access-list\s+\d+\s+(permit|deny|remark)\b/.test(t)) iosScore += 2;
    if (/^ip access-group\b/.test(t)) iosScore += 2;
    if (/^version\s+\d+\.\d+/.test(t)) iosScore += 1;
  }

  return asaScore > iosScore ? 'asa' : 'ios';
}
