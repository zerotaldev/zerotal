import { describe, it, expect, beforeEach } from "bun:test";
import { recordHttp, beginHttp, endHttp, httpMetrics, _resetHttpMetrics } from "./HttpMetrics.ts";

describe("HttpMetrics", () => {
  beforeEach(() => _resetHttpMetrics());

  it("tracks in-flight requests, floored at zero", () => {
    expect(httpMetrics().inFlight).toBe(0);
    beginHttp();
    beginHttp();
    expect(httpMetrics().inFlight).toBe(2);
    endHttp();
    expect(httpMetrics().inFlight).toBe(1);
    endHttp();
    endHttp(); // extra decrement must not go negative
    expect(httpMetrics().inFlight).toBe(0);
  });

  it("classifies status codes and computes counts + rates", () => {
    for (let i = 0; i < 90; i++) recordHttp(200, 10);
    for (let i = 0; i < 5; i++) recordHttp(302, 5);
    for (let i = 0; i < 3; i++) recordHttp(404, 8);
    for (let i = 0; i < 2; i++) recordHttp(500, 200);

    const m = httpMetrics();
    expect(m.total).toBe(100);
    expect(m.success).toBe(95); // 2xx + 3xx
    expect(m.clientErrors).toBe(3); // 4xx
    expect(m.serverErrors).toBe(2); // 5xx
    expect(m.successRate).toBe(95);
    expect(m.maxMs).toBe(200); // slowest
    expect(m.last5m.errors).toBe(5); // 4xx + 5xx in the recent window
    expect(m.avgMs).toBe(Math.round((90 * 10 + 5 * 5 + 3 * 8 + 2 * 200) / 100));
    expect(m.p95Ms).toBeGreaterThanOrEqual(10);
  });

  it("defaults to 100% success rate with no traffic", () => {
    const m = httpMetrics();
    expect(m.total).toBe(0);
    expect(m.successRate).toBe(100);
    expect(m.avgMs).toBe(0);
  });
});
