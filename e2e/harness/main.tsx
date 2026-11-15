// Entry point for the browser check (npm run test:browser). It mounts the
// REAL app — shell, routing, every screen — with one substitution made by
// e2e/vite.config.ts: src/providers/TeamProvider is swapped for
// MockTeamProvider, which serves a sample team from memory instead of
// signing in and reading Firestore. See e2e/screens.e2e.ts for what is
// checked and docs/CONTRIBUTING.md for when to run it.
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "../../src/fonts";
import "../../src/styles.css";
import App from "../../src/App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
