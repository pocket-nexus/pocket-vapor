// vapor/oracle/entry-sokoban-playdate.ts — oracle bundle entry for the
// Playdate Sokoban variant (vapor/examples/sokoban/sokoban.playdate.tsx).
// Same hook installation as entry-playdate.ts; mounts the crank-driven
// Sokoban so its button + relative-axis rules replay under real Vue Vapor.

import { createVaporApp, nextTick } from "vue";
import SokobanPlaydateApp from "../examples/sokoban/sokoban.playdate.tsx";
import {
  __dispatchAxisDelta,
  __dispatchButton,
  __resetButtons,
} from "../host/input.ts";

type AnyApp = { mount(container: unknown): void; unmount(): void };

const hooks = globalThis as Record<string, unknown>;

hooks.__vaporBoot = (container: unknown): AnyApp => {
  __resetButtons();
  const app = (createVaporApp as unknown as (comp: unknown) => AnyApp)({
    setup: () => (SokobanPlaydateApp as () => unknown)(),
  });
  app.mount(container);
  return app;
};

hooks.__vaporPress = (button: number): void => {
  __dispatchButton(button);
};

hooks.__vaporAxisDelta = (axis: number, delta: number): void => {
  __dispatchAxisDelta(axis as 0 | 1, delta);
};

hooks.__vaporTick = (): Promise<void> => nextTick();
