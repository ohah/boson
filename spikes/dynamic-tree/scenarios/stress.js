boson.createNode(1, 0, "column", 0);
boson.setStyle(1, { padding: 8, gap: 1 });
boson.createNode(2, 1, "button", 0);
boson.setText(2, `Stress ${BOSON_COUNT}: 0`);
boson.setStyle(2, { height: 60 });

for (let index = 0; index < BOSON_COUNT; index++) {
  const id = index + 10;
  boson.createNode(id, 1, "text", index + 10);
  boson.setText(id, `Item ${index}`);
  boson.setStyle(id, { height: 24 });
}

let taps = 0;
let present = false;
boson.onEvent((id) => {
  if (id !== 2) return;
  taps++;
  boson.setText(2, `Stress ${BOSON_COUNT}: ${taps}`);
  if (!present) {
    boson.createNode(3, 1, "text", 5);
    boson.setText(3, "Dynamic node");
    boson.setStyle(3, { height: 24 });
  } else {
    boson.removeNode(3);
  }
  present = !present;
});
