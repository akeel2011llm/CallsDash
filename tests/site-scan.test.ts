import { describe, expect, it } from "vitest";
import { isPrivateAddress, normalizeUrl, parseSite, scanSite, ScanError, type Fetched } from "@/lib/site-scan";

const html = `<!doctype html><html lang="en"><head><title>Al Noor Medical Center &amp; Clinics</title>
<meta name="description" content="Family medicine, dentistry and physiotherapy in Manama.">
<link rel="alternate" hreflang="ar" href="/ar"></head><body>
<script>var phone = "+973 1111 2222";</script><style>.x{}</style>
<h1>Welcome to Al Noor</h1><h2>Our services</h2><p>We open Saturday to Thursday.</p>
<a href="tel:+97317001122">Call us</a> <p>WhatsApp: +973 3600 1122</p>
<a href="mailto:Info@alnoor.example.bh?subject=Hi">Email</a> <img src="logo@2x.png">
<h3>Dentistry</h3></body></html>`;

describe("parseSite", () => {
  const s = parseSite(html, "https://alnoor.example.bh/", new Date("2026-10-20T00:00:00Z"));
  it("reads the title, description and headings", () => {
    expect(s.title).toBe("Al Noor Medical Center & Clinics");
    expect(s.description).toContain("Family medicine");
    expect(s.headings).toEqual(["Welcome to Al Noor", "Our services", "Dentistry"]);
  });
  it("finds phones and emails once each, in a clean form", () => {
    expect(s.phones).toEqual(["+97317001122", "+97336001122"]);
    expect(s.emails).toEqual(["info@alnoor.example.bh"]);
  });
  it("ignores scripts and styles in the text", () => {
    expect(s.text).toContain("We open Saturday to Thursday");
    expect(s.text).not.toContain("var phone");
  });
  it("detects languages from lang and hreflang", () => {
    expect(s.languages.sort()).toEqual(["ar", "en"]);
  });
});

describe("addresses", () => {
  it("flags private and local ones", () => {
    for (const ip of ["127.0.0.1", "10.0.0.5", "172.16.1.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "100.64.0.1"])
      expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "172.32.0.1", "104.18.0.1", "2606:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
  it("normalizes web addresses and rejects others", () => {
    expect(normalizeUrl("clinic.bh").toString()).toBe("https://clinic.bh/");
    for (const bad of ["", "ftp://x.com", "file:///etc/passwd", "javascript:alert(1)", "https://user:pw@x.com", "localhost"]) expect(() => normalizeUrl(bad), bad).toThrow(ScanError);
  });
});

describe("scanSite", () => {
  const ok = (body = html): Fetched => ({ status: 200, contentType: "text/html; charset=utf-8", body });
  const publicDns = async () => ["93.184.216.34"];

  it("scans a public page", async () => {
    const s = await scanSite("alnoor.example.bh", { fetcher: async () => ok(), resolve: publicDns });
    expect(s.title).toContain("Al Noor");
    expect(s.url).toBe("https://alnoor.example.bh/");
  });
  it("never fetches a name that resolves to a private address", async () => {
    let called = false;
    await expect(scanSite("evil.example.com", { fetcher: async () => { called = true; return ok(); }, resolve: async () => ["10.0.0.1"] })).rejects.toMatchObject({ code: "blocked" });
    expect(called).toBe(false);
    await expect(scanSite("http://127.0.0.1/admin", { fetcher: async () => ok(), resolve: publicDns })).rejects.toMatchObject({ code: "blocked" });
    await expect(scanSite("http://localhost:3000", { fetcher: async () => ok(), resolve: publicDns })).rejects.toBeInstanceOf(ScanError);
    await expect(scanSite("http://printer.local/", { fetcher: async () => ok(), resolve: publicDns })).rejects.toMatchObject({ code: "blocked" });
  });
  it("checks every redirect, not just the first address", async () => {
    const hops: string[] = [];
    const fetcher = async (u: string): Promise<Fetched> => { hops.push(u); return { status: 302, location: "http://169.254.169.254/latest/meta-data", contentType: "", body: "" }; };
    await expect(scanSite("example.com", { fetcher, resolve: publicDns })).rejects.toMatchObject({ code: "blocked" });
    expect(hops).toEqual(["https://example.com/"]);
  });
  it("follows a normal redirect, but not forever", async () => {
    let n = 0;
    const s = await scanSite("a.example.com", { resolve: publicDns, fetcher: async () => (n++ === 0 ? { status: 301, location: "https://www.a.example.com/home", contentType: "", body: "" } : ok()) });
    expect(s.url).toBe("https://www.a.example.com/home");
    await expect(scanSite("loop.example.com", { resolve: publicDns, fetcher: async () => ({ status: 302, location: "/again", contentType: "", body: "" }) })).rejects.toMatchObject({ code: "unreachable" });
  });
  it("rejects errors, non-HTML and empty pages", async () => {
    await expect(scanSite("a.example.com", { resolve: publicDns, fetcher: async () => ({ status: 500, contentType: "text/html", body: "" }) })).rejects.toMatchObject({ code: "unreachable" });
    await expect(scanSite("a.example.com", { resolve: publicDns, fetcher: async () => ({ status: 200, contentType: "application/pdf", body: "x" }) })).rejects.toMatchObject({ code: "not_html" });
    await expect(scanSite("a.example.com", { resolve: publicDns, fetcher: async () => ok("<html><body></body></html>") })).rejects.toMatchObject({ code: "empty" });
    await expect(scanSite("a.example.com", { resolve: async () => { throw new Error("nx"); }, fetcher: async () => ok() })).rejects.toMatchObject({ code: "unreachable" });
  });
});
