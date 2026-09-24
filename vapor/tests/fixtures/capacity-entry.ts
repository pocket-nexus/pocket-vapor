// vapor/tests/fixtures/capacity-entry.ts — oracle bundle entry for capacity.tsx.
// Mirrors board-entry.ts: mounts the per-pool-capacity fixture so push/pop
// past a declared cap replay under real Vue Vapor.

import { createVaporApp, nextTick } from "vue";
import CapacityApp from "./capacity.tsx";
import { __dispatchButton, __resetButtons } from "../../host/input.ts";

type AnyApp = { mount(container: unknown): void; unmount(): void };

const hooks = globalThis as Record<string, unknown>;

hooks.__vaporBoot = (container: unknown): AnyApp => {
  __resetButtons();
  const app = (createVaporApp as unknown as (comp: unknown) => AnyApp)({
    setup: () => (CapacityApp as () => unknown)(),
  });
  app.mount(container);
  return app;
};

hooks.__vaporPress = (button: number): void => {
  __dispatchButton(button);
};

hooks.__vaporTick = (): Promise<void> => nextTick();
