// vapor/tests/fixtures/board.tsx — pooled STRING-row board for the
// record string-field indexed read (vp_sb_at) + in-place write (putChar ->
// vp_sb_put) tests.
//
// A 7x3 board, one record per row with a single string field; a cursor moves
// with the d-pad and A toggles the cell under it between '.' and '$' by
// reading the byte with a dynamic index and writing one byte in place.
// Select deliberately writes one byte PAST the string end, which must leave
// the board unchanged (and trip VP_TRIP_INDEX on device). Row 3 shows the
// cursor coordinates.
//
// This file runs unmodified under real Vue Vapor (the oracle) and under the
// Pocket Vapor compiler: that dual life is the whole point of putChar.

import { ref, computed } from "vue";
import { Button, onButton } from "../../host/input.ts";
import { putChar } from "../../host/text.ts";

const W = 7;
const H = 3;
const CH = ".$@";

interface Line {
  text: string;
}

export default () => {
  const rows = ref<Line[]>([
    { text: "......." },
    { text: "......." },
    { text: "......." },
  ]);
  const cx = ref(0);
  const cy = ref(0);

  function toggle(): void {
    const ln = rows.value[cy.value];
    if (ln) {
      if (ln.text[cx.value] === CH[1]) ln.text = putChar(ln.text, cx.value, CH[0]);
      else ln.text = putChar(ln.text, cx.value, CH[1]);
    }
  }

  function badWrite(): void {
    const ln = rows.value[0];
    if (ln) ln.text = putChar(ln.text, 9, CH[2]); // 9 >= len 7: no-op
  }

  function move(dx: number, dy: number): void {
    const nx = cx.value + dx;
    const ny = cy.value + dy;
    if (nx >= 0 && nx < W) cx.value = nx;
    if (ny >= 0 && ny < H) cy.value = ny;
  }

  onButton((b) => {
    if (b === Button.A) toggle();
    else if (b === Button.Select) badWrite();
    else if (b === Button.Right) move(1, 0);
    else if (b === Button.Left) move(-1, 0);
    else if (b === Button.Down) move(0, 1);
    else if (b === Button.Up) move(0, -1);
  });

  return (
    <>
      {rows.value.map((rr, i) => (
        <row y={i}>{rr.text}</row>
      ))}
      <row y={3}>{cx.value},{cy.value}</row>
    </>
  );
};
