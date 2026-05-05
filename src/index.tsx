import React from "react";
import ReactDOM from "react-dom/client";
// @ts-ignore - App.jsx is plain JS without type declarations
import App from "./App";

const rootElement = document.getElementById("root")!;
const root = ReactDOM.createRoot(rootElement);

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
