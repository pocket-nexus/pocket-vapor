// vapor/tests/fixtures/null-write.tsx — Reviewer 1094 F3 fixture: writes
// through a record pointer the compiler itself knows can be null (pool index
// out of range yields the ternary's `: 0`). Real Vue throws a TypeError; an
// unguarded device stored through a near-null pointer and the GBA hung. The
// subset contract is now: skip the write, set VP_TRIP_NULL, keep running.
//
// A writes a record STRING field (putChar), B writes a NUMBER field, both
// through rows.value[3] while the pool holds one record. Right bumps the
// counter so the test can prove the frame loop is still alive.
import { ref, computed } from "vue";
import { Button, onButton } from "../../host/input.ts";
import { putChar } from "../../host/text.ts";

interface Line {
  text: string;
  n: number;
}

export default () => {
  const rows = ref<Line[]>([{ text: "abcde", n: 1 }]);
  const seen = ref(0);
  function badStr(): void {
    const ln = rows.value[3]; // pool length is 1 -> null at runtime
    ln.text = putChar(ln.text, 0, "Z");
  }
  function badNum(): void {
    const ln = rows.value[3];
    ln.n = 7;
  }
  onButton((b) => {
    if (b === Button.A) badStr();
    else if (b === Button.B) badNum();
    seen.value = seen.value + 1;
  });
  return (
    <>
      {rows.value.map((rr, i) => (
        <row y={i}>{rr.text}</row>
      ))}
      <row y={2}>{seen.value}</row>
    </>
  );
};
