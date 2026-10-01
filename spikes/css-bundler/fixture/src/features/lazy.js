import "./feature.css";
import "../styles/shared.css";

export function mount(root) {
  root.classList.add("feature-mounted");
  root.dataset.featureStyleLoaded = "true";
}
