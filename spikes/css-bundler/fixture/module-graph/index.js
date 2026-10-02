import { appValues } from "./app.js";
export const loadFeature = () => import("./features/lazy.js");
globalThis.__spinonGraphFixture = { appValues, loadFeature };
