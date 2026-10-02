import "./lazy.css";

export const lazyFeatureName = "lazy-feature";

export function loadIcon() {
  return import("./icon.js");
}
