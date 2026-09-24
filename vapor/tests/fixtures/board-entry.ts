// vapor/tests/fixtures/board-entry.ts — oracle bundle entry for board.tsx.
// Mirrors oracle/entry.ts but mounts the pooled-string-row test board so the
// read/putChar semantics replay under real Vue Vapor.

import { createVaporApp, nextTick } from "vue";
import BoardApp from "./board.tsx";
import { __dispatchButton, __resetButtons } from "../../host/input.ts";

type AnyApp = { mount(container: unknown): void; unmount(): void };

const hooks = globalThis as Record<string, unknown>;

hooks.__vaporBoot = (container: unknown): AnyApp => {
  __resetButtons();
  const app = (createVaporApp as unknown as (comp: unknown) => AnyApp)({
    setup: () => (BoardApp as () => unknown)(),
  });
  app.mount(container);
  return app;
};

hooks.__vaporPress = (button: number): void => {
  __dispatchButton(button);
};

hooks.__vaporTick = (): Promise<void> => nextTick();
