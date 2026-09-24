// vapor/oracle/entry-pure-helper.ts — oracle bundle entry for the
// number-returning-helper fixture (vapor/tests/fixtures/pure-helper.tsx).
//
// Same hook installation as entry.ts; mounts the fixture instead of Todo so
// its plain-TS helpers run under the real runtime-with-vapor.

import { createVaporApp, nextTick } from "vue";
import PureHelperApp from "../tests/fixtures/pure-helper.tsx";
import { __dispatchButton, __resetButtons } from "../host/input.ts";

type AnyApp = { mount(container: unknown): void; unmount(): void };

const hooks = globalThis as Record<string, unknown>;

hooks.__vaporBoot = (container: unknown): AnyApp => {
  __resetButtons();
  const app = (createVaporApp as unknown as (comp: unknown) => AnyApp)({
    setup: () => (PureHelperApp as () => unknown)(),
  });
  app.mount(container);
  return app;
};

hooks.__vaporPress = (b: number): void => {
  __dispatchButton(b);
};

hooks.__vaporTick = (): Promise<void> => nextTick();
