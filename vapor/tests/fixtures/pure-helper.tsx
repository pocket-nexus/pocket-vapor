// vapor/tests/fixtures/pure-helper.tsx — fixture for number-returning helpers.
//
// The pure helpers codeAt/score are the subject: they read refs and records
// but write nothing, so they compile to plain s32 C functions and must behave
// identically under real Vue Vapor (oracle.test.ts) and the AOT ROM.

import { computed, ref } from "vue";
import { Button, onButton } from "../../host/input.ts";

interface Cell {
  k: number;
}

export default () => {
  const cells = ref<Cell[]>([{ k: 1 }, { k: 2 }, { k: 3 }]);
  const cur = ref(0);

  function codeAt(i: number): number {
    const c = cells.value[i];
    if (c) return c.k;
    return 0;
  }

  function score(): number {
    return codeAt(0) + codeAt(1) + codeAt(2);
  }

  // a pure helper feeding a computed: the returned s32 flows through the
  // existing number path with no extra state
  const total = computed(() => score());

  onButton((b) => {
    if (b === Button.A) {
      const c = cells.value[cur.value];
      if (c) c.k = c.k + 1;
    } else if (b === Button.Right) {
      if (cur.value + 1 < cells.value.length) cur.value = cur.value + 1;
    } else if (b === Button.Left) {
      if (cur.value > 0) cur.value = cur.value - 1;
    }
  });

  return (
    <>
      <row y={0}>{"S "}{score()}</row>
      <row y={1}>{"I "}{cur.value}{" V "}{codeAt(cur.value)}{" T "}{total.value}</row>
    </>
  );
};
