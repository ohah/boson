let taps = 0;

boson.createNode(1, "button");
boson.createNode(2, "text");
boson.setText("Taps: 0");

boson.onEvent((nodeId) => {
  if (nodeId !== 1) return;
  taps += 1;
  boson.setText(`Taps: ${taps}`);
});
