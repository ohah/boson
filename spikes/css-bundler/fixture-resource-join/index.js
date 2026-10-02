import "./styles/app.css";

export function loadLazyFeature() {
  return import("./features/lazy.js");
}
