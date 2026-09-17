// Standalone Vue JSX adapter for the host oracle (derived from PocketJS, MIT).
import { transformAsync } from "@babel/core";
import tsPreset from "@babel/preset-typescript";
import { transformVueJsxVapor } from "vue-jsx-vapor/api";
import { propsHelperCode, propsHelperId, ssrHelperCode, ssrHelperId, vaporHelperCode, vaporHelperId, vdomHelperCode, vdomHelperId } from "@vue-jsx-vapor/runtime/raw";
import type { BunPlugin } from "bun";
import { fileURLToPath } from "node:url";

function patchVaporHelperCode(code: string): string {
  return code.replace(
    `if (i && i.appContext.vapor && p === "__vapor") {
          return true;
        }
        return Reflect.get`,
    `if (i && i.appContext.vapor && p === "__vapor") {
          return true;
        }
        if (i && i.appContext.vapor && p === "inheritAttrs") {
          return false;
        }
        return Reflect.get`,
  );
}

const VAPOR_HELPERS = new Map([
  [propsHelperId, propsHelperCode],
  [vdomHelperId, vdomHelperCode],
  [vaporHelperId, patchVaporHelperCode(vaporHelperCode)],
  [ssrHelperId, ssrHelperCode],
]);

export function oracleJsxPlugin(): BunPlugin {
  return {
    name: "pocket-vapor-oracle-jsx",
    setup(build) {
      build.onResolve({ filter: /^vue$/ }, () => ({
        path: fileURLToPath(new URL("../../node_modules/vue/dist/vue.runtime-with-vapor.esm-browser.prod.js", import.meta.url)),
      }));
      build.onResolve({ filter: /^\/vue-jsx-vapor\/(?:props|vdom|vapor|ssr)$/ }, args => ({ path: args.path, namespace: "vue-vapor-helper" }));
      build.onLoad({ filter: /.*/, namespace: "vue-vapor-helper" }, args => ({ contents: VAPOR_HELPERS.get(args.path)!, loader: "js" }));
      build.onLoad({ filter: /\.tsx?$/ }, async args => {
        if (args.path.includes("/node_modules/") || args.path.endsWith(".d.ts")) return;
        const source = await Bun.file(args.path).text();
        const vapor = transformVueJsxVapor(source, args.path, {}, false, false, false);
        const result = await transformAsync(vapor.code, {
          filename: args.path, presets: [[tsPreset, {}]], parserOpts: { plugins: ["jsx"] },
          babelrc: false, configFile: false, sourceMaps: false,
        });
        if (result?.code == null) throw new Error(`Vue JSX transform produced no output for ${args.path}`);
        return { contents: result.code, loader: "js" };
      });
    },
  };
}
