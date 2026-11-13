import { createRoot } from "react-dom/client";
import App from "./App";
import "./globals.css";
import { loadSettings } from "./utils/settings";

const saved = loadSettings();
if (saved?.options.theme && saved.options.theme !== 'summer') {
  document.documentElement.dataset.theme = saved.options.theme;
}
document.documentElement.dataset.textSize = saved?.options.textSize ?? 'normal';
document.documentElement.dataset.cardSize = saved?.options.cardSize ?? 'normal';
document.documentElement.dataset.animations = (saved?.options.animations ?? true) ? 'on' : 'off';

createRoot(document.getElementById("root")!).render(<App />);
