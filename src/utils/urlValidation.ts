export interface ValidatedMediaUrl {
  valid: boolean;
  error?: string;
}

export type ResolvedIpAddress = { address: string; family: number };

const BLOCKED_IPV4_RANGES = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const;

function ipv4ToNumber(address: string): number {
  return address.split(".").reduce((value, octet) => ((value << 8) | Number(octet)) >>> 0, 0);
}

function parseIpv4Octets(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) return null;
  const octets = parts.map(Number);
  return octets.some((part) => part < 0 || part > 255 || !Number.isInteger(part)) ? null : octets;
}

function isInIpv4Range(address: string, network: string, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4ToNumber(address) & mask) === (ipv4ToNumber(network) & mask);
}

function isPublicIpv4(address: string): boolean {
  if (!parseIpv4Octets(address)) return false;
  return !BLOCKED_IPV4_RANGES.some(([network, prefix]) => isInIpv4Range(address, network, prefix));
}

function expandEmbeddedIpv4(address: string): string | null {
  const normalized = address.toLowerCase();
  if (!normalized.includes(".")) return normalized;
  const lastColon = normalized.lastIndexOf(":");
  const octets = parseIpv4Octets(normalized.slice(lastColon + 1));
  if (!octets) return null;
  const high = ((octets[0] << 8) | octets[1]).toString(16);
  const low = ((octets[2] << 8) | octets[3]).toString(16);
  return `${normalized.slice(0, lastColon + 1)}${high}:${low}`;
}

function ipv6Groups(address: string): number[] | null {
  const normalized = expandEmbeddedIpv4(address);
  if (!normalized) return null;
  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if ([...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const groups = [...left, ...Array(missing).fill("0"), ...right].map((part) => Number.parseInt(part, 16));
  return groups.length === 8 && groups.every((part) => Number.isInteger(part) && part >= 0 && part <= 0xffff)
    ? groups
    : null;
}

function isMappedIpv4(groups: number[]): boolean {
  return groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
}

function isPublicMappedIpv4(groups: number[]): boolean {
  const v4 = [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255].join(".");
  return isPublicIpv4(v4);
}

function isGloballyRoutableIpv6(groups: number[]): boolean {
  const globallyRoutable = groups[0] >= 0x2000 && groups[0] <= 0x3fff;
  return globallyRoutable;
}

function isSpecialIpv6(groups: number[]): boolean {
  const protocolAssignments = groups[0] === 0x2001 && groups[1] <= 0x01ff;
  const documentation = (groups[0] === 0x2001 && groups[1] === 0x0db8) ||
    (groups[0] === 0x3fff && groups[1] < 0x1000);
  return protocolAssignments || documentation || groups[0] === 0x2002;
}

function isPublicIpv6(address: string): boolean {
  const groups = ipv6Groups(address);
  if (!groups) return false;
  if (isMappedIpv4(groups)) return isPublicMappedIpv4(groups);
  return isGloballyRoutableIpv6(groups) && !isSpecialIpv6(groups);
}

export function isPublicIpAddress(address: string): boolean {
  const family = getIpAddressFamily(address);
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

export function getIpAddressFamily(address: string): 0 | 4 | 6 {
  if (parseIpv4Octets(address)) return 4;
  return ipv6Groups(address) ? 6 : 0;
}

export function validateMediaUrl(value: string): ValidatedMediaUrl {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { valid: false, error: "Invalid URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { valid: false, error: `Blocked protocol: ${parsed.protocol}` };
  }
  if (parsed.username || parsed.password) return { valid: false, error: "URL credentials are not allowed" };
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) {
    return { valid: false, error: `Blocked host: ${hostname || "empty"}` };
  }
  const family = getIpAddressFamily(hostname);
  if (family && !isPublicIpAddress(hostname)) return { valid: false, error: `Blocked non-public IP: ${hostname}` };
  return { valid: true };
}

export function validateResolvedMediaAddresses(addresses: ResolvedIpAddress[]): ValidatedMediaUrl {
  if (addresses.length === 0) return { valid: false, error: "Host did not resolve" };
  const blocked = addresses.find((entry) => !isPublicIpAddress(entry.address));
  return blocked
    ? { valid: false, error: `Blocked non-public IP: ${blocked.address}` }
    : { valid: true };
}
