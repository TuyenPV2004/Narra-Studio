import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/app/App";

export function bootstrapSourceRenderer(): void {
  const rootElement = document.getElementById("root");

  if (!rootElement) {
    throw new Error("Source renderer root element is missing.");
  }

  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
