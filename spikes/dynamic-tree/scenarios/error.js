boson.createNode(1, 0, "column", 0);
boson.setStyle(1, { padding: 24, gap: 12 });
boson.createNode(2, 1, "button", 0);
boson.setText(2, "Trigger JS error");
boson.setStyle(2, { height: 64 });
boson.onEvent((id) => {
  if (id !== 2) return;
  boson.createNode(3, 1, "text", 10);
  boson.setText(3, "Partially created");
  throw new Error("intentional failure after mutation");
});
