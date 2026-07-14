// IPv4 アドレス・サブネット計算ユーティリティ。
// V2 の IP フィルタ(あるアドレスを含むルールへの絞り込み、サブネット包含判定)などに使う。

/** ドット区切り IPv4 を 32bit 符号なし整数へ。不正なら null。 */
export function ipToInt(ip: string): number | null {
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = (value << 8) | n;
  }
  // >>> 0 で符号なし 32bit に正規化。
  return value >>> 0;
}

/** 32bit 整数をドット区切り IPv4 へ。 */
export function intToIp(value: number): string {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ].join('.');
}

/** IOS のワイルドカード(逆マスク)をサブネットマスクへ。0.0.0.255 -> 255.255.255.0 */
export function wildcardToMask(wildcard: string): string | null {
  const w = ipToInt(wildcard);
  if (w === null) return null;
  return intToIp(~w >>> 0);
}

/** サブネットマスク(255.255.255.0)を prefix 長へ。連続 1 でなければ null。 */
export function maskToPrefix(mask: string): number | null {
  const m = ipToInt(mask);
  if (m === null) return null;
  // マスクは先頭から連続した 1 でなければならない。
  const inverted = ~m >>> 0;
  // inverted + 1 が 2 の冪ならマスクは連続 1。
  if (((inverted + 1) & inverted) !== 0) return null;
  let prefix = 0;
  let bit = m;
  for (let i = 0; i < 32; i++) {
    if ((bit & 0x80000000) !== 0) prefix++;
    else break;
    bit = (bit << 1) >>> 0;
  }
  return prefix;
}

/**
 * サブネットマスク(255.255.255.0)をワイルドカード(0.0.0.255)へ。
 * ASA は ACL・object でワイルドカードでなく netmask を用いるため、IR(wildcard 保持)へ変換する際に使う。
 * ビット反転なので数学的には wildcardToMask と同一だが、意図を明確にするため別名で公開する。
 */
export function maskToWildcard(mask: string): string | null {
  const m = ipToInt(mask);
  if (m === null) return null;
  return intToIp(~m >>> 0);
}

/** ワイルドカードから CIDR prefix 長へ。連続でない(不連続ワイルドカード)場合は null。 */
export function wildcardToPrefix(wildcard: string): number | null {
  const mask = wildcardToMask(wildcard);
  if (mask === null) return null;
  return maskToPrefix(mask);
}

/**
 * addr/wildcard で表される範囲に、対象 IP が含まれるか。
 * ワイルドカードの 0 ビット位置のみ一致すればよい(Cisco の照合規則)。
 * 不連続ワイルドカードにも対応する。
 */
export function matchesWildcard(target: string, addr: string, wildcard: string): boolean {
  const t = ipToInt(target);
  const a = ipToInt(addr);
  const w = ipToInt(wildcard);
  if (t === null || a === null || w === null) return false;
  // ワイルドカードが 1 のビットは無視、0 のビットだけ比較。
  return ((t ^ a) & ~w) >>> 0 ? false : true;
}

/** addr/wildcard を "10.0.0.0/24" 形式に整形。不連続なら "addr wildcard" のまま返す。 */
export function formatSubnet(addr: string, wildcard: string): string {
  if (wildcard === '0.0.0.0') return addr;
  const prefix = wildcardToPrefix(wildcard);
  if (prefix === null) return `${addr} ${wildcard}`;
  return `${addr}/${prefix}`;
}
