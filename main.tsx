import { createRoot } from "react-dom/client";
import App from "./App";
import "./globals.css";
import { loadSettings } from "./utils/settings";

const saved = loadSettings();
if (saved?.options.theme && saved.options.theme !== 'summer') {
  document.documentElement.dataset.theme = saved.options.theme;
}

createRoot(document.getElementById("root")!).render(<App />);
