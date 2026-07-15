import { downloadTeamBackup } from "./teamBackup";
import { getLocalDateString } from "../constants/ui";

describe("downloadTeamBackup", () => {
  let origCreate: unknown;
  let origRevoke: unknown;
  let anchor: HTMLAnchorElement | null;

  beforeEach(() => {
    origCreate = (URL as unknown as { createObjectURL: unknown })
      .createObjectURL;
    origRevoke = (URL as unknown as { revokeObjectURL: unknown })
      .revokeObjectURL;
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = jest.fn(
      () => "blob:test",
    );
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL =
      jest.fn();
    anchor = null;
    const realCreate = document.createElement.bind(document);
    jest
      .spyOn(document, "createElement")
      .mockImplementation((tag: string, ...rest: unknown[]) => {
        const el = realCreate(tag as any, ...(rest as []));
        if (tag === "a") {
          anchor = el as HTMLAnchorElement;
          (el as HTMLAnchorElement).click = jest.fn();
        }
        return el;
      });
  });

  afterEach(() => {
    (URL as unknown as { createObjectURL: unknown }).createObjectURL =
      origCreate;
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL =
      origRevoke;
    (
      document.createElement as unknown as { mockRestore?: () => void }
    ).mockRestore?.();
  });

  it("downloads a snapshot file named for the team + date", () => {
    downloadTeamBackup({ players: [] }, "t1", "snapshot");
    expect(
      (URL as unknown as { createObjectURL: ReturnType<typeof jest.fn> })
        .createObjectURL,
    ).toHaveBeenCalledTimes(1);
    expect(anchor).not.toBeNull();
    expect(anchor!.download).toBe(
      `lineup-snapshot-t1-${getLocalDateString()}.json`,
    );
    expect(anchor!.click).toHaveBeenCalledTimes(1);
  });

  it("defaults to the 'backup' label and tolerates a missing team id", () => {
    downloadTeamBackup({}, null);
    expect(anchor!.download).toBe(
      `lineup-backup-team-${getLocalDateString()}.json`,
    );
  });

  it("no-ops without throwing when Blob URLs are unavailable", () => {
    (URL as unknown as { createObjectURL: unknown }).createObjectURL =
      undefined;
    expect(() => downloadTeamBackup({}, "t1")).not.toThrow();
    expect(anchor).toBeNull();
  });
});
