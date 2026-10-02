import "./styles/base.css";
import "./styles/shared.css";
import "@theme/theme.css";
import "@fixture/theme/theme.css";
import { card, featured } from "./styles/card.module.css";
import { sharedRuntimeValue } from "./shared/runtime.js";

const root = document.querySelector("#app");
root.className = `${card} ${featured}`;
root.dataset.cssModuleKeys = "card,featured";
root.dataset.sharedRuntimeValue = sharedRuntimeValue;

const button = document.createElement("button");
button.textContent = "기능 스타일 불러오기";
button.addEventListener("click", async () => {
  const feature = await import(/* webpackChunkName: "feature" */ "./features/lazy.js");
  feature.mount(root);
});
root.append(button);
