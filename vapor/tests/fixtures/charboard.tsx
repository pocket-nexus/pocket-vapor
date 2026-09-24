// vapor/tests/fixtures/charboard.tsx — char vs one-character string literal
// (D207). A 4-wide row "#..#" lives both as a record string field and as a
// ROM const string; movement and marking branch on `field[i] === "#"` and
// `CONST[i] !== "#"`. Under sdcc/cc65 those must lower to C char-literal
// comparisons — char vs `const char[2] __code` is rejected outright.
//
// This file runs unmodified under real Vue Vapor (the oracle) and under the
// Pocket Vapor compiler.

import { ref, computed } from "vue";
import { Button, onButton } from "../../host/input.ts";

const W = 4;
const ROMS = "#..#";

interface Line {
  text: string;
}

export default () => {
  const rows = ref<Line[]>([{ text: "#..#" }]);
  const cx = ref(1);
  const marks = ref(0);

  function tryMove(d: number): void {
    const nx = cx.value + d;
    if (nx >= 0 && nx < W) {
      const t = rows.value[0];
      if (t && t.text[nx] === "#") return; // wall: record-field char vs literal
      cx.value = nx;
    }
  }

  onButton((b) => {
    if (b === Button.Left) tryMove(-1);
    else if (b === Button.Right) tryMove(1);
    else if (b === Button.A) {
      if (ROMS[cx.value] !== "#") marks.value = marks.value + 1; // ROM-row char vs literal
    }
  });

  return (
    <>
      {rows.value.map((rr, i) => (
        <row y={i}>{rr.text}</row>
      ))}
      <row y={1}>{cx.value}</row>
      <row y={2}>{marks.value}</row>
    </>
  );
};
