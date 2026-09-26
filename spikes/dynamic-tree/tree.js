// The same JS owns the tree, including creation, deletion and sibling order.
let taps = 0;
let detailsVisible = false;

boson.createNode(1, 0, "column", 0);
boson.setStyle(1, { padding: 24, gap: 16 });

boson.createNode(2, 1, "text", 0);
boson.setText(2, "Taps: 0");
boson.setStyle(2, { height: 60 });

boson.createNode(3, 1, "button", 10);
boson.setText(3, "Toggle details");
boson.setStyle(3, { height: 64 });

boson.createNode(5, 1, "row", 30);
boson.setStyle(5, { height: 56, gap: 8 });
boson.createNode(6, 5, "text", 0);
boson.setText(6, "Rust layout");
boson.setStyle(6, { flexGrow: 1 });
boson.createNode(7, 5, "text", 10);
boson.setText(7, "V8 events");
boson.setStyle(7, { flexGrow: 1 });

boson.onEvent((nodeId) => {
  if (nodeId !== 3) return;
  taps += 1;
  boson.setText(2, `Taps: ${taps}`);
  detailsVisible = !detailsVisible;
  if (detailsVisible) {
    boson.createNode(4, 1, "text", 20);
    boson.setText(4, `Detail added on tap ${taps}`);
    boson.setStyle(4, { height: 48 });
  } else {
    boson.removeNode(4);
  }
});
