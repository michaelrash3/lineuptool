import React from "react";
import { render, fireEvent } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary";

const Boom = ({ when }: { when: boolean }) => {
  if (when) throw new Error("kaboom");
  return <div>healthy screen</div>;
};

describe("ErrorBoundary", () => {
  // The thrown error logs to console.error via componentDidCatch + React's own
  // logging; silence it so the test output stays readable.
  let spy: jest.SpyInstance;
  beforeEach(() => {
    spy = jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => spy.mockRestore());

  test("shows a recoverable fallback instead of a blank screen when a child throws", () => {
    const { getByText } = render(
      <ErrorBoundary>
        <Boom when />
      </ErrorBoundary>,
    );
    expect(getByText("Something went wrong")).toBeInTheDocument();
    expect(getByText("Reload Page")).toBeInTheDocument();
    expect(getByText("Try Again")).toBeInTheDocument();
  });

  test("recovers when the reset key changes (e.g. navigating tabs)", () => {
    const { getByText, queryByText, rerender } = render(
      <ErrorBoundary resetKey="/settings">
        <Boom when />
      </ErrorBoundary>,
    );
    expect(getByText("Something went wrong")).toBeInTheDocument();

    rerender(
      <ErrorBoundary resetKey="/roster">
        <Boom when={false} />
      </ErrorBoundary>,
    );
    expect(queryByText("Something went wrong")).not.toBeInTheDocument();
    expect(getByText("healthy screen")).toBeInTheDocument();
  });
});
