import { describe, it, expect } from "vitest";
import { sanitizeBackup } from "./backupSanitizer";

const TODAY = "2026-07-03";

describe("sanitizeBackup", () => {
  it("strips ACL/identity keys — a restore replaces content, not access control", () => {
    const { data } = sanitizeBackup(
      {
        name: "Hawks",
        players: [],
        ownerId: "stale-owner",
        members: ["a", "b"],
        coachRoles: { a: "head" },
        joinCode: "OLD123",
      },
      TODAY,
    );
    expect(data.name).toBe("Hawks");
    expect(data.players).toEqual([]);
    expect("ownerId" in data).toBe(false);
    expect("members" in data).toBe(false);
    expect("coachRoles" in data).toBe(false);
    expect("joinCode" in data).toBe(false);
  });

  it("trims datetime strings to their date without counting a repair", () => {
    const { data, repairedFinanceDates } = sanitizeBackup(
      {
        players: [],
        finances: {
          payments: [
            {
              id: "p1",
              playerId: "k1",
              date: "2026-03-01T14:30:00.000Z",
              amount: 100,
            },
          ],
        },
      },
      TODAY,
    );
    const payments = (data.finances as any).payments;
    expect(payments[0].date).toBe("2026-03-01");
    expect(repairedFinanceDates).toBe(0);
  });

  it("repairs blank/malformed dates to today and counts them", () => {
    const { data, repairedFinanceDates } = sanitizeBackup(
      {
        players: [],
        finances: {
          incomes: [
            { id: "i1", date: "", label: "Car wash", amount: 50 },
            { id: "i2", date: "not-a-date", label: "Raffle", amount: 25 },
            { id: "i3", date: "2026-04-01", label: "Fine", amount: 10 },
          ],
          expenses: [{ id: "e1", label: "Balls", amount: 40 }], // date missing
        },
      },
      TODAY,
    );
    const fin = data.finances as any;
    expect(fin.incomes[0].date).toBe(TODAY);
    expect(fin.incomes[1].date).toBe(TODAY);
    expect(fin.incomes[2].date).toBe("2026-04-01");
    expect(fin.expenses[0].date).toBe(TODAY);
    expect(repairedFinanceDates).toBe(3);
  });

  it("leaves a sponsorship without a date alone (the field is optional)", () => {
    const { data, repairedFinanceDates } = sanitizeBackup(
      {
        players: [],
        finances: {
          sponsorships: [
            { id: "s1", sponsor: "Pizza Co", amount: 200 },
            { id: "s2", sponsor: "Hardware", amount: 100, date: "bogus" },
          ],
        },
      },
      TODAY,
    );
    const sponsorships = (data.finances as any).sponsorships;
    expect("date" in sponsorships[0]).toBe(false);
    expect(sponsorships[1].date).toBe(TODAY);
    expect(repairedFinanceDates).toBe(1);
  });

  it("backfills missing ids and coerces non-numeric amounts to 0", () => {
    const { data } = sanitizeBackup(
      {
        players: [],
        finances: {
          payments: [
            { playerId: "k1", date: "2026-03-01", amount: "not-money" },
          ],
        },
      },
      TODAY,
    );
    const payment = (data.finances as any).payments[0];
    expect(typeof payment.id).toBe("string");
    expect(payment.id.length).toBeGreaterThan(0);
    expect(payment.amount).toBe(0);
  });

  it("passes through a backup without finances untouched", () => {
    const { data, repairedFinanceDates } = sanitizeBackup(
      { players: [{ id: "p1", name: "Ava" }] },
      TODAY,
    );
    expect(data.players).toEqual([{ id: "p1", name: "Ava" }]);
    expect(repairedFinanceDates).toBe(0);
  });
});
