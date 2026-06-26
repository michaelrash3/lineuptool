import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useTheme } from "./useTheme";

const STORAGE_KEY = "cc.theme";

const root = () => document.documentElement;

beforeEach(() => {
  localStorage.clear();
  root().removeAttribute("data-theme");
});

afterEach(() => {
  localStorage.clear();
  root().removeAttribute("data-theme");
});

describe("useTheme", () => {
  it("defaults to dark (the showcase look) for a first-time visitor", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.mode).toBe("dark");
    expect(result.current.resolved).toBe("dark");
    // Applied to the document so there's no flash mismatch with the pre-paint script.
    expect(root().getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("dark");
  });

  it("reads a previously stored mode on mount", () => {
    localStorage.setItem(STORAGE_KEY, "light");
    const { result } = renderHook(() => useTheme());
    expect(result.current.mode).toBe("light");
    expect(result.current.resolved).toBe("light");
    expect(root().hasAttribute("data-theme")).toBe(false);
  });

  it("setMode('light') clears the dark attribute and persists the choice", () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setMode("light"));
    expect(result.current.mode).toBe("light");
    expect(root().hasAttribute("data-theme")).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("light");
  });

  it("toggle() flips between light and dark", () => {
    localStorage.setItem(STORAGE_KEY, "light");
    const { result } = renderHook(() => useTheme());
    act(() => result.current.toggle());
    expect(result.current.resolved).toBe("dark");
    expect(root().getAttribute("data-theme")).toBe("dark");
    act(() => result.current.toggle());
    expect(result.current.resolved).toBe("light");
    expect(root().hasAttribute("data-theme")).toBe(false);
  });

  it("ignores an unrecognized stored value and falls back to dark", () => {
    localStorage.setItem(STORAGE_KEY, "neon");
    const { result } = renderHook(() => useTheme());
    expect(result.current.mode).toBe("dark");
  });
});
