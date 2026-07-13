import { describe, expect, it } from "vitest";

import {
  assessMobileServerAuthority,
  isAllowedLoopbackHostname,
  isAllowedLoopbackHttpUrl,
} from "./loopback-authority";

describe("Mobile loopback authority", () => {
  it.each(["localhost", "LOCALHOST", "127.0.0.1", "[::1]", "::1"])(
    "accepts the exact loopback hostname %s",
    (hostname) => expect(isAllowedLoopbackHostname(hostname)).toBe(true),
  );

  it.each([
    "",
    "127.0.0.2",
    "127.1.2.3",
    "192.168.1.8",
    "astr.local",
    "localhost.evil.test",
    "127.0.0.1.evil",
  ])("rejects the non-allowlisted hostname %s", (hostname) => {
    expect(isAllowedLoopbackHostname(hostname)).toBe(false);
  });

  it.each([
    "http://localhost",
    "https://localhost:8443/core",
    "http://127.0.0.1:8300",
    "https://[::1]:8300/v1/stream",
  ])("accepts the credential-free loopback HTTP URL %s", (url) => {
    expect(isAllowedLoopbackHttpUrl(url)).toBe(true);
  });

  it.each([
    "ftp://localhost/resource",
    "file://localhost/tmp/core",
    "http://user@localhost",
    "https://user:secret@127.0.0.1",
    "http://localhost.evil.test",
    "http://127.0.0.2:8300",
    "https://remote.example",
    "not a url",
    "",
  ])("rejects the non-authoritative URL %s", (url) => {
    expect(isAllowedLoopbackHttpUrl(url)).toBe(false);
  });

  it("requires both private and public Core targets to be loopback", () => {
    expect(assessMobileServerAuthority({})).toBe(true);
    expect(
      assessMobileServerAuthority({
        coreUrl: "http://localhost:8300",
        publicCoreUrl: "https://[::1]:8300",
      }),
    ).toBe(true);
    expect(
      assessMobileServerAuthority({
        coreUrl: "https://remote.example",
        publicCoreUrl: "http://127.0.0.1:8300",
      }),
    ).toBe(false);
    expect(
      assessMobileServerAuthority({
        coreUrl: "http://127.0.0.1:8300",
        publicCoreUrl: "https://remote.example",
      }),
    ).toBe(false);
    expect(
      assessMobileServerAuthority({
        coreUrl: "invalid",
        publicCoreUrl: "http://127.0.0.1:8300",
      }),
    ).toBe(false);
  });
});
