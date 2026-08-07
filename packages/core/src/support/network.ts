/**
 * This machine's address on the local network, so a starting server can print a
 * URL that other devices can actually open.
 *
 * `http://localhost` only ever reaches the machine serving it. Opening the app
 * on a phone means knowing this box's LAN address, and hunting for it with
 * `ipconfig` is the kind of thing a dev server should just tell you.
 */
import { networkInterfaces } from "node:os";

/** The shape read off each interface — narrowed so tests can pass plain objects. */
type InterfaceInfo = {
  address: string;
  /** `"IPv4"` from Bun and Node's `os` module; some runtimes report the number `4`. */
  family: string | number;
  internal: boolean;
};

/** An interface table, as returned by `os.networkInterfaces()`. */
type Interfaces = Record<string, readonly InterfaceInfo[] | undefined>;

/**
 * Adapters belonging to a virtual machine, container runtime, or VPN rather than
 * to the network the developer's phone is on. They hold real, non-internal IPv4
 * addresses — a Windows box with WSL and Hyper-V reports several — so they are
 * ranked last rather than dropped: on a machine that has nothing else, a
 * reachable address still beats none at all.
 */
const VIRTUAL_ADAPTER =
  /vethernet|virtualbox|vmware|hyper-?v|wsl|docker|tailscale|zerotier|utun|veth|br-|tun\d|tap\d/i;

/**
 * The best guess at this machine's LAN address, or `undefined` when it is on no
 * network at all (an offline laptop, most containers).
 *
 * @example
 * const host = localNetworkAddress();
 * console.log(host ? `http://${host}:3000` : "no network");
 */
export function localNetworkAddress(): string | undefined {
  return _pickAddress(networkInterfaces());
}

// ── Private ──────────────────────────────────────────────────────────────────

/**
 * The choice itself, over an injected interface table.
 *
 * @internal Exported so the ranking can be tested against machines this one is not.
 */
export function _pickAddress(interfaces: Interfaces): string | undefined {
  let best: { address: string; rank: number } | undefined;

  for (const [adapter, addresses] of Object.entries(interfaces)) {
    for (const info of addresses ?? []) {
      if (info.internal) continue;
      if (info.family !== "IPv4" && info.family !== 4) continue;
      // 169.254.x.x is the address an adapter gives itself when DHCP never
      // answered: the interface is up, but on no network anyone can reach.
      if (info.address.startsWith("169.254.")) continue;

      const rank = (VIRTUAL_ADAPTER.test(adapter) ? 10 : 0) + _scopeRank(info.address);
      if (!best || rank < best.rank) best = { address: info.address, rank };
    }
  }

  return best?.address;
}

/** Lower is better: the ranges a home or office LAN actually hands out come first. */
function _scopeRank(address: string): number {
  if (address.startsWith("192.168.")) return 0;
  if (address.startsWith("10.")) return 1;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 2;
  // 100.64–127.x is carrier-grade NAT space, which is how Tailscale and similar
  // overlays address a machine — reachable, but not from the phone on this Wi-Fi.
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(address)) return 4;
  return 3;
}
