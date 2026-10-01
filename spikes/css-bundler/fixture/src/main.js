import "./styles/base.css";
import "./styles/shared.css";
import { card, featured } from "./styles/card.module.css";

const root = document.querySelector("#app");
root.className = `${card} ${featured}`;
root.dataset.cssModuleKeys = "card,featured";

const button = document.createElement("button");
button.textContent = "기능 스타일 불러오기";
button.addEventListener("click", async () => {
  const feature = await import(/* webpackChunkName: "feature" */ "./features/lazy.js");
  feature.mount(root);
});
root.append(button);
