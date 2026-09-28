use std::error::Error;

use spinon_core::{ChangeBatch, NodeId, Tree};

fn main() -> Result<(), Box<dyn Error>> {
    let root = NodeId::new(1).expect("0은 예약된 ID입니다");
    let label = NodeId::new(2).expect("0은 예약된 ID입니다");
    let mut tree = Tree::new();
    let mut batch = ChangeBatch::new(tree.revision());
    batch
        .create(root, "div")
        .insert(root, None, 0)
        .create(label, "span")
        .insert(label, Some(root), 0)
        .update_text(label, "Spinon");

    let receipt = tree.commit(batch)?;
    assert_eq!(receipt.revision().get(), 1);
    assert_eq!(
        tree.node(label).and_then(|node| node.text()),
        Some("Spinon")
    );
    Ok(())
}
