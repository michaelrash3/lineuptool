import { useCallback, useEffect, useRef, useState } from "react";
import { deleteDoc, getDoc, setDoc } from "firebase/firestore";
import { db, appId } from "../firebase";
import type { Team, ToastContextValue } from "../types";
import {
  CALENDAR_FEED_MAX_CHARS,
  CALENDAR_FEED_TOKEN_RE,
  buildCalendarFeedIcs,
  calendarFeedContentKey,
  calendarFeedRef,
  newCalendarFeedToken,
} from "../utils/calendarFeed";

interface UseCalendarFeedArgs {
  activeTeamId: string | null;
  user: { uid: string } | null;
  teamData: any;
  // The games on screen are what the SERVER holds for this team — not a first
  // paint from the local cache, which can be empty or a day old. Publishing
  // from that would blank (or roll back) every subscriber's calendar.
  gamesReady: boolean;
  isHead: boolean;
  updateTeam: (patch: Partial<Team>) => void;
  toast: ToastContextValue;
}

const RETRY_MS = 30_000;

// Keeps the team's calendarFeeds doc in step with the schedule while the team has a
// subscription link, and owns turning the link on and off. Any coach's open
// app republishes after a change (the rules let any member write the doc, but
// only for the team's current token); only a head coach can create or retire
// the token itself. See src/utils/calendarFeed.ts for the design.
export const useCalendarFeed = ({
  activeTeamId,
  user,
  teamData,
  gamesReady,
  isHead,
  updateTeam,
  toast,
}: UseCalendarFeedArgs) => {
  const lastPublishedRef = useRef("");
  const [retry, setRetry] = useState(0);
  const token = String(teamData?.calendarFeedToken || "");
  const games = teamData?.games;
  const teamName = teamData?.name;

  useEffect(() => {
    if (!activeTeamId || !user || !gamesReady) return undefined;
    if (!CALENDAR_FEED_TOKEN_RE.test(token)) {
      lastPublishedRef.current = "";
      return undefined;
    }
    const ics = buildCalendarFeedIcs({ name: teamName, games });
    if (ics.length > CALENDAR_FEED_MAX_CHARS) return undefined;
    const content = calendarFeedContentKey(ics);
    const key = `${activeTeamId}:${token}:${content}`;
    if (lastPublishedRef.current === key) return undefined;
    lastPublishedRef.current = key;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ref = calendarFeedRef(db, appId, activeTeamId, token);
    // Read first: opening the app shouldn't rewrite a feed that already says
    // the same thing (and stamp every event as freshly changed).
    getDoc(ref)
      .then((snap) =>
        snap.exists() &&
        calendarFeedContentKey(String(snap.data()?.ics || "")) === content
          ? undefined
          : setDoc(ref, { teamId: activeTeamId, ics, updatedAt: Date.now() }),
      )
      .catch(() => {
        // Nothing else will re-run this until the schedule next changes, and
        // a feed that silently stopped updating is the failure that matters.
        lastPublishedRef.current = "";
        timer = setTimeout(() => setRetry((n) => n + 1), RETRY_MS);
      });
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [activeTeamId, user, gamesReady, token, games, teamName, retry]);

  const enableCalendarFeed = useCallback(() => {
    if (!isHead || !activeTeamId) return;
    // The effect above publishes the feed once the token is on the team.
    updateTeam({ calendarFeedToken: newCalendarFeedToken() });
  }, [isHead, activeTeamId, updateTeam]);

  // Take the published doc down FIRST, and only then forget its token: the
  // other order could strand a readable feed nobody can find to delete.
  const disableCalendarFeed = useCallback(async () => {
    if (!isHead || !activeTeamId) return false;
    try {
      if (CALENDAR_FEED_TOKEN_RE.test(token))
        await deleteDoc(calendarFeedRef(db, appId, activeTeamId, token));
    } catch {
      toast.push({
        kind: "error",
        title: "Couldn't turn the calendar link off",
        message: "The link still works. Check your connection and try again.",
      });
      return false;
    }
    updateTeam({ calendarFeedToken: null });
    return true;
  }, [isHead, activeTeamId, token, updateTeam, toast]);

  return { enableCalendarFeed, disableCalendarFeed };
};
