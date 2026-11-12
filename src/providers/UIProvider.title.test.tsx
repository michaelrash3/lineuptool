import React, { useEffect } from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// The browser-tab title names the screen the coach is on. Tabs carry their own
// id in activeTab; standalone pages (Help, Season Report, …) carry their first
// URL segment as a phantom id (see useMainShellRouting). Both need a label, or
// the tab strip, history and phone task switcher show only the team name.

vi.mock("../firebase", () => ({ auth: {}, db: {}, appId: "test-app" }));

import { UIProvider } from "./UIProvider";
import { TeamContext, TeamActionsContext, useUI } from "../contexts";
import { makeTeam } from "../test-utils";
import { TAB_TO_PATH } from "../hooks/useMainShellRouting";

const Show = ({ tab }: { tab: string }) => {
  const { setActiveTab } = useUI();
  useEffect(() => setActiveTab(tab), [tab, setActiveTab]);
  return null;
};

const titleFor = (tab: string) => {
  const team = makeTeam({
    team: { name: "Hawks", players: [], games: [] },
    uiBridge: { current: {} },
  });
  const { unmount } = render(
    <MemoryRouter>
      <TeamContext.Provider value={team}>
        <TeamActionsContext.Provider value={team}>
          <UIProvider>
            <Show tab={tab} />
          </UIProvider>
        </TeamActionsContext.Provider>
      </TeamContext.Provider>
    </MemoryRouter>,
  );
  const title = document.title;
  unmount();
  return title;
};

describe("UIProvider — document title", () => {
  it.each(Object.keys(TAB_TO_PATH))("names the %s tab", (tab) => {
    expect(titleFor(tab)).toMatch(/^Hawks · \S/);
  });

  it.each([
    ["help", "Hawks · Help"],
    ["season-report", "Hawks · Season Report"],
    ["awards", "Hawks · Awards"],
    ["playing-time", "Hawks · Playing Time"],
    ["lineup", "Hawks · What-If Lineup"],
  ])("names the standalone page %s", (segment, title) => {
    expect(titleFor(segment)).toBe(title);
  });

  it("falls back to the team name for an unknown page", () => {
    expect(titleFor("somewhere-new")).toBe("Hawks");
  });
});
