// vapor/tests/fixtures/null-write-entry.ts — oracle bundle entry for null-write.tsx.

import { createVaporApp, nextTick } from "vue";
import NullWriteApp from "./null-write.tsx";
import { __dispatchButton, __resetButtons } from "../../host/input.ts";

type AnyApp = { mount(container: unknown): void; unmount(): void };

const hooks = globalThis as Record<string, unknown>;

hooks.__vaporBoot = (container: unknown): AnyApp => {
  __resetButtons();
  const app = (createVaporApp as unknown as (comp: unknown) => AnyApp)({
    setup: () => (NullWriteApp as () => unknown)(),
  });
  app.mount(container);
  return app;
};

hooks.__vaporPress = (button: number): void => {
  __dispatchButton(button);
};

hooks.__vaporTick = (): Promise<void> => nextTick();
