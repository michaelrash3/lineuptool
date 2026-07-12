import React from "react";
import { Navigate, useLocation, useParams } from "react-router-dom";

// Redirects a retired URL shape to its renamed equivalent, preserving route
// params and navigation state, so pre-rename bookmarks and history entries
// keep resolving. Used for the offer→letter and roster→settings import
// renames; the TARGET route owns all gating, the alias only forwards.
export const RouteAlias = ({
  to,
}: {
  to: (params: Record<string, string | undefined>) => string;
}) => {
  const params = useParams();
  const location = useLocation();
  return <Navigate to={to(params)} state={location.state} replace />;
};
