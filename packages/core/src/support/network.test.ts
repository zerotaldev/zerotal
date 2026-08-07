import { describe, it, expect } from "bun:test";
import { localNetworkAddress, _pickAddress } from "./network.ts";

/** One IPv4 entry, with the fields the picker actually reads. */
function ipv4(
  address: string,
  internal = false,
): { address: string; family: string; internal: boolean } {
  return { address, family: "IPv4", internal };
}

describe("_pickAddress()", () => {
  it("returns the LAN address of a plainly-connected machine", () => {
    expect(
      _pickAddress({
        lo: [ipv4("127.0.0.1", true)],
        eth0: [ipv4("192.168.1.42")],
      }),
    ).toBe("192.168.1.42");
  });

  it("prefers the Wi-Fi address over the virtual adapters around it", () => {
    // The failure this guards: a Windows dev box reports WSL and Hyper-V
    // adapters as ordinary non-internal IPv4 interfaces, and taking the first
    // one printed an address that no phone on the network can reach.
    const address = _pickAddress({
      "vEthernet (WSL)": [ipv4("172.29.16.1")],
      "vEthernet (Default Switch)": [ipv4("172.17.128.1")],
      "Wi-Fi": [ipv4("192.168.0.15")],
    });

    expect(address).toBe("192.168.0.15");
  });

  it("falls back to a virtual adapter rather than reporting nothing", () => {
    expect(_pickAddress({ docker0: [ipv4("172.17.0.1")] })).toBe("172.17.0.1");
  });

  it("skips loopback, IPv6, and self-assigned addresses", () => {
    expect(
      _pickAddress({
        lo: [ipv4("127.0.0.1", true)],
        eth0: [{ address: "fe80::1", family: "IPv6", internal: false }],
        // DHCP never answered on this one — the interface is up, on no network.
        eth1: [ipv4("169.254.7.9")],
      }),
    ).toBeUndefined();
  });

  it("accepts the numeric family some runtimes report", () => {
    expect(_pickAddress({ eth0: [{ address: "10.0.0.8", family: 4, internal: false }] })).toBe(
      "10.0.0.8",
    );
  });

  it("ranks a real LAN above a VPN's carrier-grade NAT address", () => {
    expect(
      _pickAddress({
        tailscale0: [ipv4("100.71.3.4")],
        en0: [ipv4("10.0.0.8")],
      }),
    ).toBe("10.0.0.8");
  });

  it("returns undefined on a machine with no external interface", () => {
    expect(_pickAddress({ lo: [ipv4("127.0.0.1", true)] })).toBeUndefined();
    expect(_pickAddress({})).toBeUndefined();
  });
});

describe("localNetworkAddress()", () => {
  it("reads the real interfaces without throwing, and yields an IPv4 address or nothing", () => {
    const address = localNetworkAddress();
    if (address !== undefined) expect(address).toMatch(/^\d{1,3}(\.\d{1,3}){3}$/);
  });
});
