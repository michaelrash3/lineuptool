import { describe, expect, it } from "vitest";
import {
  buildEvalReminderDraft,
  buildGameReminderDraft,
  buildMailtoUrl,
  collectParentEmails,
  draftToText,
} from "./reminderDraft";

describe("buildMailtoUrl", () => {
  it("percent-encodes recipient, subject, and body (spaces as %20)", () => {
    const url = buildMailtoUrl("a@b.com", "Game vs Hawks", "See you there");
    expect(url).toBe(
      "mailto:a%40b.com?subject=Game%20vs%20Hawks&body=See%20you%20there",
    );
  });
});

describe("draftToText", () => {
  it("renders a recipient header, subject, and body", () => {
    const text = draftToText({ subject: "Hi", body: "Body line" }, [
      "a@b.com",
      "c@d.com",
    ]);
    expect(text).toBe("To: a@b.com, c@d.com\nSubject: Hi\n\nBody line");
  });
  it("omits the To header when there are no recipients", () => {
    expect(draftToText({ subject: "S", body: "B" })).toBe("Subject: S\n\nB");
  });
});

describe("collectParentEmails", () => {
  it("dedupes valid emails from players + un-applied submissions", () => {
    const team = {
      players: [
        { id: "1", name: "A", email: "a@x.com", parent2Email: "b@x.com" },
        { id: "2", name: "B", email: "a@x.com" }, // dupe
        { id: "3", name: "C", email: "not-an-email" }, // invalid
      ],
      playerInfoSubmissions: [
        {
          id: "s1",
          submittedAt: "",
          firstName: "",
          lastName: "",
          email: "c@x.com",
        },
      ],
    };
    expect(collectParentEmails(team as never).sort()).toEqual([
      "a@x.com",
      "b@x.com",
      "c@x.com",
    ]);
  });
  it("returns [] for an empty team", () => {
    expect(collectParentEmails(null)).toEqual([]);
  });
});

describe("buildGameReminderDraft", () => {
  it("uses 'vs' for home games and includes when/where", () => {
    const d = buildGameReminderDraft({
      teamName: "Hawks",
      opponent: "Bears",
      dateLabel: "Sat, Jun 27",
      timeLabel: "5:00 PM",
      location: "City Park\nField 3",
      isHome: true,
    });
    expect(d.subject).toBe("[Hawks] Game vs Bears — Sat, Jun 27");
    expect(d.body).toContain("Hawks plays vs Bears");
    expect(d.body).toContain("When: Sat, Jun 27 at 5:00 PM");
    expect(d.body).toContain("Where: City Park"); // first line only
    expect(d.body).not.toContain("Field 3");
  });
  it("uses 'at' for away games", () => {
    const d = buildGameReminderDraft({
      teamName: "Hawks",
      opponent: "Bears",
      isHome: false,
    });
    expect(d.subject).toContain("Game at Bears");
  });
});

describe("buildEvalReminderDraft", () => {
  it("addresses the staff and embeds the eval link", () => {
    const d = buildEvalReminderDraft({
      teamName: "Hawks",
      fromName: "Coach Pat",
      url: "https://app/#/evaluation",
    });
    expect(d.subject).toBe("[Hawks] Eval round due");
    expect(d.body).toContain("Coach Pat is asking");
    expect(d.body).toContain("https://app/#/evaluation");
  });
});
