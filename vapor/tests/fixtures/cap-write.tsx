// vapor/tests/fixtures/cap-write.tsx — Reviewer 1094 F4 fixture: a record
// string filled to the gba/gb capacity (24), then a putChar at index == len.
// Vue returns the string unchanged; the device must trip VP_TRIP_INDEX and
// write nothing. If the write bound is off by one, b[24] is the NEXT pool
// record's len byte, so row 1 changes.
import { ref, computed } from "vue";
import { Button, onButton } from "../../host/input.ts";
import { putChar } from "../../host/text.ts";

interface Line {
  text: string;
}

export default () => {
  const rows = ref<Line[]>([{ text: "AAAAAAAAAAAAAAAAAAAAAAAA" }, { text: "bbb" }]);
  const n = ref(0);
  function pastCap(): void {
    const r = rows.value[0];
    if (r) r.text = putChar(r.text, 24, "Z");
  }
  onButton((b) => {
    if (b === Button.A) pastCap();
    n.value = n.value + 1;
  });
  return (
    <>
      {rows.value.map((rr, i) => (
        <row y={i}>{rr.text}</row>
      ))}
      <row y={2}>{n.value}</row>
    </>
  );
};
