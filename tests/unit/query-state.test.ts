import { describe, it, expect } from "vitest";
import { queryReducer, selectQueryView, type QueryInternalState } from "../../src/hooks/shared";

const initial: QueryInternalState<string[]> = { data: null, key: "k1", fetching: true, error: null, errorStatus: null };

describe("useQuery state", () => {
  it("first load: loading until data arrives", () => {
    expect(selectQueryView(initial, "k1", true)).toMatchObject({ data: null, loading: true, fetching: true });
    const loaded = queryReducer(initial, { type: "success", key: "k1", data: ["a"] });
    expect(selectQueryView(loaded, "k1", true)).toMatchObject({ data: ["a"], loading: false, fetching: false });
  });

  it("refetch keeps the data visible (no skeleton flash) and marks fetching", () => {
    const loaded = queryReducer(initial, { type: "success", key: "k1", data: ["a"] });
    const refetching = queryReducer(loaded, { type: "start", key: "k1" });
    expect(selectQueryView(refetching, "k1", true)).toMatchObject({ data: ["a"], loading: false, fetching: true });
    const refreshed = queryReducer(refetching, { type: "success", key: "k1", data: ["a", "b"] });
    expect(refreshed.data).toEqual(["a", "b"]);
  });

  it("a failed refetch keeps the old data and reports the error with its status", () => {
    const loaded = queryReducer(initial, { type: "success", key: "k1", data: ["a"] });
    const failed = queryReducer(queryReducer(loaded, { type: "start", key: "k1" }), {
      type: "failure",
      key: "k1",
      error: "Shopwave API error (502): down",
      errorStatus: 502,
    });
    expect(selectQueryView(failed, "k1", true)).toMatchObject({ data: ["a"], error: "Shopwave API error (502): down", errorStatus: 502, fetching: false });
  });

  it("new params drop the old data, even before the effect runs", () => {
    const loaded = queryReducer(initial, { type: "success", key: "k1", data: ["a"] });
    expect(selectQueryView(loaded, "k2", true)).toMatchObject({ data: null, loading: true });
    const started = queryReducer(loaded, { type: "start", key: "k2" });
    expect(started).toMatchObject({ data: null, key: "k2", fetching: true });
  });

  it("ignores results for params that are no longer current", () => {
    const started = queryReducer(initial, { type: "start", key: "k2" });
    expect(queryReducer(started, { type: "success", key: "k1", data: ["stale"] })).toBe(started);
    expect(queryReducer(started, { type: "failure", key: "k1", error: "x", errorStatus: 1 })).toBe(started);
  });

  it("disabled: not loading", () => {
    const idle = queryReducer({ ...initial, key: null, fetching: false }, { type: "idle" });
    expect(selectQueryView(idle, "k1", false)).toMatchObject({ data: null, loading: false, fetching: false });
  });
});
