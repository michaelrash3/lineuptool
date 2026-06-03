import { vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { setDoc } from "firebase/firestore";
import { csvEscape, useImportExportFlows } from "./useImportExportFlows";
import { makeToast } from "../test-utils";

// Schedule imports now write game docs to a subcollection, so the hook imports
// firebase. Stub it; encode doc paths for assertions.
vi.mock("../firebase", () => ({ appId: "app", db: {} }));
vi.mock("../utils/errorReporter", () => ({ reportError: vi.fn() }));
vi.mock("firebase/firestore", () => ({
  doc: vi.fn((_db: any, ...path: string[]) => ({ path: path.join("/") })),
  setDoc: vi.fn(() => Promise.resolve()),
}));

const mockSetDoc = setDoc as unknown as ReturnType<typeof vi.fn>;

describe("csvEscape", () => {
  it("passes through plain values untouched", () => {
    expect(csvEscape("Rivera")).toBe("Rivera");
    expect(csvEscape(12)).toBe("12");
  });

  it("renders null/undefined as an empty field", () => {
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(undefined)).toBe("");
  });

  it("quotes values containing commas, quotes, or newlines", () => {
    expect(csvEscape("Smith, Jr.")).toBe('"Smith, Jr."');
    expect(csvEscape("line one\nline two")).toBe('"line one\nline two"');
    // Embedded quotes are doubled per RFC 4180.
    expect(csvEscape('He said "go"')).toBe('"He said ""go"""');
  });
});

const setupScheduleImport = () => {
  const updateTeam = jest.fn();
  const toast = makeToast();
  const teamData = {
    games: [],
    leagueRuleSet: "USSSA",
    pitchingFormat: "Kid Pitch",
    defenseSize: 9,
    battingSize: 10,
    positionLock: false,
  };
  const { result } = renderHook(() =>
    useImportExportFlows({
      teamData,
      updateTeam,
      activeTeamId: "t1",
      toast,
    } as any)
  );
  const run = (csv: string) => {
    const file = new File([csv], "schedule.csv", { type: "text/csv" });
    result.current.uploadScheduleCsv({
      target: { files: [file], value: "" },
    } as any);
  };
  return { run, updateTeam, toast };
};

beforeEach(() => {
  mockSetDoc.mockClear();
});

describe("uploadScheduleCsv", () => {
  it("imports valid rows to the games subcollection and surfaces unrecognized dates", async () => {
    const { run, toast } = setupScheduleImport();
    run(
      "Date,Opponent\n" +
        "2026-05-01,Rays\n" +
        "05/08/2026,Cubs\n" +
        "someday,Sharks\n" + // unparseable date -> skipped + surfaced
        ",NoDateRow\n" + // blank date -> ignored silently
        "\n" // trailing blank line -> ignored
    );
    await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(2));
    const opponents = mockSetDoc.mock.calls.map((c: any) => c[1].opponent);
    expect(opponents).toEqual(["Rays", "Cubs"]);
    expect(mockSetDoc.mock.calls[0][0].path).toContain("/games/");
    expect(toast.push).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "success",
        title: "Imported 2 games",
        message: "Skipped 1 row with an unrecognized date.",
      })
    );
  });

  it("omits the skipped message when every dated row parses", async () => {
    const { run, toast } = setupScheduleImport();
    run("Date,Opponent\n2026-05-01,Rays\n");
    await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(1));
    expect(toast.push).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Imported 1 game", message: undefined })
    );
  });

  it("errors when no date column is present", async () => {
    const { run, toast } = setupScheduleImport();
    run("Team,Opponent\nUs,Them\n");
    await waitFor(() =>
      expect(toast.push).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "error",
          title: "Schedule import failed",
        })
      )
    );
    expect(mockSetDoc).not.toHaveBeenCalled();
  });
});
