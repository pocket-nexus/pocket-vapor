// vapor/tests/fixtures/capacity.tsx — per-pool static capacity fixture.
//
// Two lists that used to share NES's single global poolCap of 8:
//   rows — a 12-record STRING-row board (the sokoban shape),
//   hist — an undo stack declared to hold 64 entries.
// withCapacity is the amphibious annotation: identity under the oracle,
// the pool's static C-array size under the compiler.
//
// A pushes one undo record (bounded by the declared 64 on device),
// B pops the newest (splice), exercising both the push guard and slot
// reuse. Row 13 shows the live length so a device runner can observe it.

import { ref, computed } from "vue";
import { Button, onButton } from "../../host/input.ts";
import { withCapacity } from "../../host/list.ts";

interface Line {
  text: string;
}

interface Hist {
  d: boolean;
}

const ROW = "..........";

export default () => {
  const rows = ref<Line[]>(
    withCapacity(
      [
        { text: ROW }, { text: ROW }, { text: ROW }, { text: ROW },
        { text: ROW }, { text: ROW }, { text: ROW }, { text: ROW },
        { text: ROW }, { text: ROW }, { text: ROW }, { text: ROW },
      ],
      12,
    ),
  );
  const hist = ref<Hist[]>(withCapacity([], 64));

  onButton((b) => {
    if (b === Button.A) hist.value.push({ d: false });
    else if (b === Button.B) hist.value.splice(hist.value.length - 1, 1);
  });

  return (
    <>
      {rows.value.map((r, i) => (
        <row y={i}>{r.text}</row>
      ))}
      <row y={13}>{hist.value.length}</row>
    </>
  );
};
