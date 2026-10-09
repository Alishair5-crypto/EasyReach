import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function ipv4Number(address: string) {
  return address.split(".").reduce((value, part) => (value << 8) | Number(part), 0) >>> 0;
}
function ipv4In(address: string, network: string, prefix: number) {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4Number(address) & mask) === (ipv4Number(network) & mask);
}
function publicIpv4(address: string) {
  if (isIP(address) !== 4) return false;
  const blocked: Array<[string, number]> = [
    ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
    ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24],
    ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
    ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
  ];
  return !blocked.some(([network, prefix]) => ipv4In(address, network, prefix));
}
function ipv6Number(address: string): bigint | null {
  let input = address.toLowerCase().split("%")[0];
  if (input.includes(".")) {
    const lastColon = input.lastIndexOf(":");
    if (lastColon < 0) return null;
    const ipv4 = input.slice(lastColon + 1);
    if (isIP(ipv4) !== 4) return null;
    const n = ipv4Number(ipv4);
    input = input.slice(0, lastColon + 1) + ((n >>> 16) & 0xffff).toString(16) + ":" + (n & 0xffff).toString(16);
  }
  const halves = input.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const groups = halves.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right] : left;
  if (groups.length !== 8 || groups.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  return groups.reduce((value, part) => (value << 16n) | BigInt(parseInt(part, 16)), 0n);
}
function ipv6In(value: bigint, network: bigint, prefix: number) {
  const shift = BigInt(128 - prefix);
  return (value >> shift) === (network >> shift);
}
function publicIpv6(address: string) {
  if (isIP(address) !== 6) return false;
  const value = ipv6Number(address);
  if (value === null) return false;
  const blocked: Array<[string, number]> = [
    ["::", 128], ["::1", 128], ["::", 96], ["fc00::", 7], ["fe80::", 10],
    ["ff00::", 8], ["2001:db8::", 32], ["2001::", 32], ["2002::", 16],
  ];
  return !blocked.some(([network, prefix]) => {
    const parsed = ipv6Number(network);
    return parsed !== null && ipv6In(value, parsed, prefix);
  });
}
export function isPublicAddress(address: string) {
  return isIP(address) === 4 ? publicIpv4(address) : isIP(address) === 6 ? publicIpv6(address) : false;
}
export function isPublicHttpsUrlSyntax(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname || url.port === "0") return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (isIP(host)) return false;
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".test")) return false;
    if (!host.includes(".") || host.length > 253 || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(host)) return false;
    return true;
  } catch { return false; }
}
export async function isPublicHttpsUrl(value: string) {
  if (!isPublicHttpsUrlSyntax(value)) return false;
  try {
    const host = new URL(value).hostname;
    const addresses = await lookup(host, { all: true, verbatim: true });
    return addresses.length > 0 && addresses.every((entry) => isPublicAddress(entry.address));
  } catch { return false; }
}
