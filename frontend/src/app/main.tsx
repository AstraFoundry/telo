import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "entities/preferences";
import { App } from "./app";
import "./styles/index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
