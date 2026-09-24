// vapor/tests/fixtures/null-ternary.tsx — review task 1161 R1 fixture.
// The write target is built from TWO ternary merges:
//   picked = choose ? first        // narrowed non-null
//                   : rows.value[3]// a second valid record (index-typed)
//   target = far    ? picked       // either arm of `picked`
//                   : rows.value[7]// out of range: null at runtime
// At every merge the result must be nullable whenever ANY arm is nullable;
// with the type union fixed, writes through it on device skip + trip
// VP_TRIP_NULL instead of dereferencing address 0. Real Vue throws a
// TypeError on the null-arm press; on every valid press oracle and device
// agree cell-for-cell.
//
// A writes a NUMBER field, B a STRING field via putChar, Down a BOOLEAN.
// Left toggles `choose` (valid arm selection), Up toggles `far` (null arm),
// Right only bumps the liveness counter.
import { ref, computed } from "vue";
import { Button, onButton } from "../../host/input.ts";
import { putChar } from "../../host/text.ts";

interface Line {
  text: string;
  n: number;
  enabled: boolean;
}

export default () => {
  const rows = ref<Line[]>([
    { text: "abcde", n: 1, enabled: false },
    { text: "fghij", n: 2, enabled: false },
    { text: "klmno", n: 3, enabled: false },
    { text: "pqrst", n: 4, enabled: false },
  ]);
  const choose = ref(true);
  const far = ref(true); // Up flips to the out-of-range rows.value[7] arm
  const seen = ref(0);
  onButton((b) => {
    if (b === Button.Left) choose.value = !choose.value;
    if (b === Button.Up) far.value = !far.value;
    if (b === Button.A || b === Button.B || b === Button.Down) {
      const first = rows.value[0];
      if (first) {
        const picked = choose.value ? first : rows.value[3];
        const target = far.value ? picked : rows.value[7];
        if (b === Button.A) target.n = 7;
        else if (b === Button.B) target.text = putChar(target.text, 0, "Z");
        else target.enabled = true;
      }
    }
    seen.value = seen.value + 1;
  });
  return (
    <>
      {rows.value.map((r, i) => (
        <row y={i}>{r.text}{"|"}{r.n}{"|"}{r.enabled ? "Y" : "N"}</row>
      ))}
      <row y={5}>{seen.value}</row>
    </>
  );
};
