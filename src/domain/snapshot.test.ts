import { describe, expect, it } from "vitest";
import { canonicalJson } from "./snapshot";

describe("canonical snapshot JSON", () => {
  it("is independent of key order, at every depth", () => {
    const a = { b: 1, a: { d: "2.50", c: [{ y: 1, x: 2 }] } };
    const b = { a: { c: [{ x: 2, y: 1 }], d: "2.50" }, b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalJson(a)).toBe('{"a":{"c":[{"x":2,"y":1}],"d":"2.50"},"b":1}');
  });

  it("keeps array order and drops undefined properties", () => {
    expect(canonicalJson({ list: [3, 1, 2], gone: undefined, nil: null })).toBe('{"list":[3,1,2],"nil":null}');
  });

  it("refuses floats and Date objects, which would make the bytes unstable", () => {
    expect(() => canonicalJson({ price: 120.46 })).toThrow(/decimal string/);
    expect(() => canonicalJson({ on: new Date() })).toThrow(/YYYY-MM-DD/);
  });
});
