spinon.createNode(1, "view");
spinon.setText("ready");

spinon.onEvent((nodeId) => {
  spinon.createNode(nodeId + 1, "text");
  spinon.setText(`이벤트:${nodeId}`);
});
