// vapor/oracle/entry-sokoban.ts — oracle bundle entry for the sokoban app
// (vapor/examples/sokoban/sokoban.tsx). Same hook installation as entry.ts;
// mounts Pocket Sokoban instead of Todo so its helpers run under the real
// runtime-with-vapor.

import { createVaporApp, nextTick } from "vue";
import SokobanApp from "../examples/sokoban/sokoban.tsx";
import { __dispatchButton, __resetButtons } from "../host/input.ts";

type AnyApp = { mount(container: unknown): void; unmount(): void };

const hooks = globalThis as Record<string, unknown>;

hooks.__vaporBoot = (container: unknown): AnyApp => {
  __resetButtons();
  const app = (createVaporApp as unknown as (comp: unknown) => AnyApp)({
    setup: () => (SokobanApp as () => unknown)(),
  });
  app.mount(container);
  return app;
};

hooks.__vaporPress = (b: number): void => {
  __dispatchButton(b);
};

hooks.__vaporTick = (): Promise<void> => nextTick();
