// vapor/tests/fixtures/guard-read.tsx — review task 1161 R2 fixture.
// The DESIGN.md §4 recommended guard for a dynamic record-string byte read
// must bound BOTH ends: `x >= 0 && x < line.text.length ? line.text[x] :
// CH[0]`. An upper-bound-only guard renders a space on device at x = -1
// (vp_sb_at's negative-index sentinel) but nothing under real Vue, so the
// two sides diverge. With the two-sided guard they agree at -1, in range,
// and past the end.
import { ref, computed } from "vue";
import { Button, onButton } from "../../host/input.ts";

const CH = "?";
interface Line {
  text: string;
}

export default () => {
  const rows = ref<Line[]>([{ text: "ABC" }]);
  const x = ref(0);
  onButton((b) => {
    if (b === Button.Left) x.value = x.value - 1;
    else if (b === Button.Right) x.value = x.value + 1;
    else if (b === Button.Down) x.value = 3;
  });
  return (
    <>
      {rows.value.map((line, i) => (
        <row y={i}>{"["}{x.value >= 0 && x.value < line.text.length ? line.text[x.value] : CH[0]}{"]"}</row>
      ))}
      <row y={2}>{x.value}</row>
    </>
  );
};
