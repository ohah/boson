boson.createNode(1, 0, "column", 0);
boson.setStyle(1, { padding: 24, gap: 12 });
boson.createNode(2, 1, "text", 0);
boson.setText(2, "Taps: 0");
boson.setStyle(2, { height: 64 });
boson.createNode(3, 1, "button", 1);
boson.setText(3, "Run calculation");
boson.setStyle(3, { height: 64 });

let taps = 0;
boson.onEvent((id) => {
  if (id !== 3) return;
  const until = Date.now() + BOSON_BUSY_MS;
  while (Date.now() < until) { /* deterministic wall-time workload on the caller thread */ }
  boson.setText(2, `Taps: ${++taps}`);
});
