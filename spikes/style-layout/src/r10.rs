use std::collections::HashMap;
use std::time::{Duration, Instant};

use taffy::compute_leaf_layout;
use taffy::prelude::*;
use taffy::style::Direction;

const SCREEN_NODE_ID: u64 = 1;
const CARD_COUNT: u64 = 8;
const BENCH_ITERATIONS: usize = 240;

#[derive(Clone, Copy)]
struct TextMetrics {
    intrinsic_width: f32,
    line_height: f32,
}

struct Scene {
    tree: TaffyTree<()>,
    nodes: HashMap<u64, NodeId>,
    text_metrics: HashMap<NodeId, TextMetrics>,
    root: NodeId,
    viewport: Size<f32>,
    direction: Direction,
}

impl Scene {
    fn new(
        viewport: Size<f32>,
        direction: Direction,
        rounded: bool,
        first_card_height: f32,
    ) -> Result<Self, String> {
        if !viewport.width.is_finite()
            || !viewport.height.is_finite()
            || viewport.width <= 0.0
            || viewport.height <= 0.0
        {
            return Err("화면 크기는 0보다 큰 유한한 값이어야 합니다".into());
        }

        let mut tree = TaffyTree::with_capacity((CARD_COUNT * 3 + 1) as usize);
        if !rounded {
            tree.disable_rounding();
        }

        let mut nodes = HashMap::new();
        let mut text_metrics = HashMap::new();
        let mut cards = Vec::with_capacity(CARD_COUNT as usize);

        for index in 0..CARD_COUNT {
            let text_external_id = 100 + index;
            let button_external_id = 200 + index;
            let card_external_id = 10 + index;

            let text = tree
                .new_leaf(Style {
                    flex_grow: 1.0,
                    min_size: Size {
                        width: LengthPercentageAuto::length(0.0),
                        height: LengthPercentageAuto::auto(),
                    },
                    ..Default::default()
                })
                .map_err(|error| error.to_string())?;
            nodes.insert(text_external_id, text);
            text_metrics.insert(
                text,
                TextMetrics {
                    // 실제 글꼴 shaping이 아니라 측정기 연결과 줄 높이 전달을 확인하는 고정 fixture입니다.
                    intrinsic_width: 320.0 + index as f32 * 4.0,
                    line_height: 20.0,
                },
            );

            let button = tree
                .new_leaf(Style {
                    flex_shrink: 0.0,
                    size: Size {
                        width: Dimension::length(64.0),
                        height: Dimension::length(40.0),
                    },
                    ..Default::default()
                })
                .map_err(|error| error.to_string())?;
            nodes.insert(button_external_id, button);

            let card = tree
                .new_with_children(
                    Style {
                        display: Display::Flex,
                        flex_direction: FlexDirection::Row,
                        direction,
                        size: Size {
                            width: Dimension::auto(),
                            height: Dimension::length(if index == 0 {
                                first_card_height
                            } else {
                                68.0
                            }),
                        },
                        gap: Size {
                            width: LengthPercentage::length(8.0),
                            height: LengthPercentage::length(0.0),
                        },
                        align_items: Some(AlignItems::CENTER),
                        ..Default::default()
                    },
                    &[text, button],
                )
                .map_err(|error| error.to_string())?;
            nodes.insert(card_external_id, card);
            cards.push(card);
        }

        let root = tree
            .new_with_children(
                Style {
                    display: Display::Flex,
                    flex_direction: FlexDirection::Column,
                    direction,
                    size: Size {
                        width: Dimension::length(viewport.width),
                        height: Dimension::length(viewport.height),
                    },
                    padding: Rect {
                        top: LengthPercentage::length(16.0),
                        right: LengthPercentage::length(16.0),
                        bottom: LengthPercentage::length(16.0),
                        left: LengthPercentage::length(16.0),
                    },
                    gap: Size {
                        width: LengthPercentage::length(0.0),
                        height: LengthPercentage::length(8.0),
                    },
                    ..Default::default()
                },
                &cards,
            )
            .map_err(|error| error.to_string())?;
        nodes.insert(SCREEN_NODE_ID, root);

        Ok(Self {
            tree,
            nodes,
            text_metrics,
            root,
            viewport,
            direction,
        })
    }

    fn compute(&mut self) -> Result<usize, String> {
        let metrics = &self.text_metrics;
        let mut measure_calls = 0;
        self.tree
            .compute_layout_with_measure(
                self.root,
                Size {
                    width: AvailableSpace::Definite(self.viewport.width),
                    height: AvailableSpace::Definite(self.viewport.height),
                },
                |inputs, node, _, style| {
                    if let Some(metrics) = metrics.get(&node) {
                        measure_calls += 1;
                        compute_leaf_layout(
                            inputs,
                            style,
                            |_, _| 0.0,
                            |known, available| {
                                let width = known
                                    .width
                                    .or_else(|| available.width.into_option())
                                    .unwrap_or(metrics.intrinsic_width)
                                    .max(1.0);
                                let lines = (metrics.intrinsic_width / width).ceil().max(1.0);
                                Size {
                                    width: metrics.intrinsic_width,
                                    height: metrics.line_height * lines,
                                }
                            },
                        )
                    } else {
                        compute_leaf_layout(inputs, style, |_, _| 0.0, |_, _| Size::ZERO)
                    }
                },
            )
            .map_err(|error| error.to_string())?;
        Ok(measure_calls)
    }

    fn frame(&self, external_id: u64) -> Result<Layout, String> {
        let node = self
            .nodes
            .get(&external_id)
            .copied()
            .ok_or_else(|| format!("외부 노드 ID {external_id}를 찾을 수 없습니다"))?;
        self.tree
            .layout(node)
            .copied()
            .map_err(|error| error.to_string())
    }

    fn card_style(&self, height: f32) -> Style {
        Style {
            display: Display::Flex,
            flex_direction: FlexDirection::Row,
            direction: self.direction,
            size: Size {
                width: Dimension::auto(),
                height: Dimension::length(height),
            },
            gap: Size {
                width: LengthPercentage::length(8.0),
                height: LengthPercentage::length(0.0),
            },
            align_items: Some(AlignItems::CENTER),
            ..Default::default()
        }
    }

    fn update_first_card_height(&mut self, height: f32) -> Result<(), String> {
        let card = self
            .nodes
            .get(&10)
            .copied()
            .ok_or("첫 번째 카드를 찾을 수 없습니다")?;
        let style = self.card_style(height);
        self.tree
            .set_style(card, style)
            .map_err(|error| error.to_string())
    }
}

fn percentiles(mut samples: Vec<Duration>) -> (f64, f64) {
    samples.sort_unstable();
    let index = |fraction: f64| ((samples.len() - 1) as f64 * fraction).round() as usize;
    (
        samples[index(0.50)].as_secs_f64() * 1_000_000.0,
        samples[index(0.95)].as_secs_f64() * 1_000_000.0,
    )
}

fn measure_incremental(scene: &mut Scene, height: f32) -> Result<Duration, String> {
    let start = Instant::now();
    scene.update_first_card_height(height)?;
    scene.compute()?;
    std::hint::black_box(scene.frame(10)?);
    Ok(start.elapsed())
}

fn measure_rebuild(
    viewport: Size<f32>,
    direction: Direction,
    height: f32,
) -> Result<Duration, String> {
    let start = Instant::now();
    let mut rebuilt = Scene::new(viewport, direction, false, height)?;
    rebuilt.compute()?;
    std::hint::black_box(rebuilt.frame(10)?);
    drop(rebuilt);
    Ok(start.elapsed())
}

fn benchmark(viewport: Size<f32>, direction: Direction) -> Result<(f64, f64, f64, f64), String> {
    let mut incremental = Scene::new(viewport, direction, false, 68.0)?;
    incremental.compute()?;
    for index in 0..20 {
        incremental.update_first_card_height(if index % 2 == 0 { 69.0 } else { 68.0 })?;
        incremental.compute()?;
    }
    for index in 0..20 {
        let mut rebuilt = Scene::new(
            viewport,
            direction,
            false,
            if index % 2 == 0 { 69.0 } else { 68.0 },
        )?;
        rebuilt.compute()?;
    }

    let mut incremental_samples = Vec::with_capacity(BENCH_ITERATIONS);
    let mut rebuild_samples = Vec::with_capacity(BENCH_ITERATIONS);
    for index in 0..BENCH_ITERATIONS {
        let height = if index % 2 == 0 { 69.0 } else { 68.0 };
        if index % 2 == 0 {
            incremental_samples.push(measure_incremental(&mut incremental, height)?);
            rebuild_samples.push(measure_rebuild(viewport, direction, height)?);
        } else {
            rebuild_samples.push(measure_rebuild(viewport, direction, height)?);
            incremental_samples.push(measure_incremental(&mut incremental, height)?);
        }
    }

    let (incremental_p50, incremental_p95) = percentiles(incremental_samples);
    let (rebuild_p50, rebuild_p95) = percentiles(rebuild_samples);
    Ok((incremental_p50, incremental_p95, rebuild_p50, rebuild_p95))
}

fn rounding_probe(scale: f32) -> Result<String, String> {
    let mut values = Vec::new();
    for (label, rounded) in [("taffy", true), ("float", false)] {
        let mut tree = TaffyTree::<()>::new();
        if !rounded {
            tree.disable_rounding();
        }
        let children = (0..3)
            .map(|_| {
                tree.new_leaf(Style {
                    flex_grow: 1.0,
                    ..Default::default()
                })
                .map_err(|error| error.to_string())
            })
            .collect::<Result<Vec<_>, _>>()?;
        let root = tree
            .new_with_children(
                Style {
                    display: Display::Flex,
                    size: Size {
                        width: Dimension::length(151.5),
                        height: Dimension::length(30.0),
                    },
                    gap: Size::zero(),
                    ..Default::default()
                },
                &children,
            )
            .map_err(|error| error.to_string())?;
        tree.compute_layout(root, Size::MAX_CONTENT)
            .map_err(|error| error.to_string())?;
        let mut edges = Vec::new();
        for child in &children {
            let layout = tree.layout(*child).map_err(|error| error.to_string())?;
            edges.push((layout.location.x, layout.location.x + layout.size.width));
        }
        if label == "float" {
            let pixel_edges = edges
                .iter()
                .map(|(start, end)| {
                    (
                        (start * scale).round() / scale,
                        (end * scale).round() / scale,
                    )
                })
                .collect::<Vec<_>>();
            values.push(format!(
                "physical-pixel={:.3}/{:.3}/{:.3}",
                pixel_edges[0].1 - pixel_edges[0].0,
                pixel_edges[1].1 - pixel_edges[1].0,
                pixel_edges[2].1 - pixel_edges[2].0
            ));
        }
        values.push(format!(
            "{label}={:.3}/{:.3}/{:.3}",
            edges[0].1 - edges[0].0,
            edges[1].1 - edges[1].0,
            edges[2].1 - edges[2].0
        ));
    }
    Ok(values.join(","))
}

fn rtl_probe(viewport: Size<f32>) -> Result<(f32, f32), String> {
    let mut ltr = Scene::new(viewport, Direction::Ltr, false, 68.0)?;
    ltr.compute()?;
    let ltr_text_x = ltr.frame(100)?.location.x;
    let ltr_button_x = ltr.frame(200)?.location.x;

    let mut rtl = Scene::new(viewport, Direction::Rtl, false, 68.0)?;
    rtl.compute()?;
    let rtl_text_x = rtl.frame(100)?.location.x;
    let rtl_button_x = rtl.frame(200)?.location.x;

    if !(ltr_text_x < ltr_button_x && rtl_button_x < rtl_text_x) {
        return Err(format!(
            "RTL 행의 시작 방향이 반전되지 않았습니다: LTR text={ltr_text_x}, button={ltr_button_x}; RTL text={rtl_text_x}, button={rtl_button_x}"
        ));
    }
    Ok((ltr_button_x - ltr_text_x, rtl_text_x - rtl_button_x))
}

fn validate_incremental_geometry(viewport: Size<f32>) -> Result<(), String> {
    let mut incremental = Scene::new(viewport, Direction::Ltr, false, 68.0)?;
    incremental.compute()?;
    incremental.update_first_card_height(69.0)?;
    incremental.compute()?;

    let mut rebuilt = Scene::new(viewport, Direction::Ltr, false, 69.0)?;
    rebuilt.compute()?;

    for id in std::iter::once(SCREEN_NODE_ID)
        .chain(10..10 + CARD_COUNT)
        .chain(100..100 + CARD_COUNT)
        .chain(200..200 + CARD_COUNT)
    {
        let actual = incremental.frame(id)?;
        let expected = rebuilt.frame(id)?;
        let fields = [
            ("x", actual.location.x, expected.location.x),
            ("y", actual.location.y, expected.location.y),
            ("width", actual.size.width, expected.size.width),
            ("height", actual.size.height, expected.size.height),
        ];
        for (field, actual, expected) in fields {
            if (actual - expected).abs() > 0.001 {
                return Err(format!(
                    "부분 갱신 결과가 전체 재생성과 다릅니다: 노드 {id} {field}={actual}, 전체={expected}"
                ));
            }
        }
    }
    Ok(())
}

/// 작은 모바일 화면 fixture에서 R10 위험 항목을 실행하고 한 줄 보고서를 반환합니다.
pub fn run_report(width: f32, height: f32, scale: f32) -> Result<String, String> {
    if !scale.is_finite() || scale <= 0.0 {
        return Err("화면 배율은 0보다 큰 유한한 값이어야 합니다".into());
    }
    let viewport = Size { width, height };
    let mut scene = Scene::new(viewport, Direction::Ltr, false, 68.0)?;
    let measure_calls = scene.compute()?;
    let text = scene.frame(100)?;
    if measure_calls == 0 || text.size.height < 40.0 {
        return Err(format!(
            "텍스트 측정 결과가 예상 범위와 다릅니다: 호출={measure_calls}, 높이={}",
            text.size.height
        ));
    }
    let (ltr_to_rtl_button_offset, rtl_to_text_offset) = rtl_probe(viewport)?;
    validate_incremental_geometry(viewport)?;
    let rounding = rounding_probe(scale)?;
    let (incremental_p50, incremental_p95, rebuild_p50, rebuild_p95) =
        benchmark(viewport, Direction::Ltr)?;

    Ok(format!(
        "viewport={width:.2}x{height:.2} logical scale={scale:.3} nodes={} text-id=100 measured={}x{} calls={measure_calls} rtl=PASS ltr-button-offset={ltr_to_rtl_button_offset:.2} rtl-text-offset={rtl_to_text_offset:.2} update=equivalent rounding=[{rounding}] update-us-p50={incremental_p50:.2} update-us-p95={incremental_p95:.2} rebuild-us-p50={rebuild_p50:.2} rebuild-us-p95={rebuild_p95:.2} iterations={BENCH_ITERATIONS} text-metrics=synthetic",
        scene.nodes.len(),
        text.size.width,
        text.size.height
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn external_node_ids_stay_mapped_through_incremental_layout() {
        let viewport = Size {
            width: 402.0,
            height: 874.0,
        };
        let mut scene = Scene::new(viewport, Direction::Ltr, false, 68.0).unwrap();
        scene.compute().unwrap();
        assert!(scene.frame(100).is_ok());
        scene.update_first_card_height(72.0).unwrap();
        scene.compute().unwrap();
        assert!(scene.frame(100).is_ok());
        assert!(scene.frame(999).is_err());
    }

    #[test]
    fn text_measurement_callback_wraps_a_leaf_under_finite_width() {
        let mut scene = Scene::new(
            Size {
                width: 402.0,
                height: 874.0,
            },
            Direction::Ltr,
            false,
            68.0,
        )
        .unwrap();
        let calls = scene.compute().unwrap();
        let text = scene.frame(100).unwrap();
        assert!(calls > 0);
        assert_eq!(text.size.width, 298.0);
        assert_eq!(text.size.height, 40.0);
    }

    #[test]
    fn rtl_reverses_the_start_edge_of_a_flex_row() {
        let (ltr, rtl) = rtl_probe(Size {
            width: 402.0,
            height: 874.0,
        })
        .unwrap();
        assert!(ltr > 0.0);
        assert!(rtl > 0.0);
    }

    #[test]
    fn viewport_and_pixel_scale_must_be_positive_and_finite() {
        assert!(Scene::new(
            Size {
                width: f32::NAN,
                height: 874.0,
            },
            Direction::Ltr,
            false,
            68.0,
        )
        .is_err());
        assert!(run_report(402.0, 874.0, 0.0).is_err());
    }

    #[test]
    fn report_identifies_synthetic_text_metrics_and_layout_costs() {
        let report = run_report(402.0, 874.0, 3.0).unwrap();
        assert!(report.contains("rtl=PASS"));
        assert!(report.contains("update=equivalent"));
        assert!(report.contains("text-metrics=synthetic"));
        assert!(report.contains("update-us-p50="));
        assert!(report.contains("rebuild-us-p50="));
    }
}
