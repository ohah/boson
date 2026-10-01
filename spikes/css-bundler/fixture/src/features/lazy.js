import "./feature.css";
import "../styles/shared.css";
import { sharedRuntimeValue } from "../shared/runtime.js";

export function mount(root) {
  root.classList.add("feature-mounted");
  root.dataset.featureStyleLoaded = "true";
  root.dataset.lazySharedRuntimeValue = sharedRuntimeValue;
}
