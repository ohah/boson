use ::style::{
    LocalName, Namespace,
    applicable_declarations::ApplicableDeclarationBlock,
    context::SharedStyleContext,
    data::{ElementData, ElementDataMut, ElementDataRef},
    dom::{LayoutIterator, TElement, TNode},
    properties::PropertyDeclarationBlock,
    selector_parser::{AttrValue, Lang, PseudoElement, SelectorImpl},
    servo_arc::{Arc, ArcBorrow},
    shared_lock::Locked,
    values::{AtomIdent, computed::Display},
};
use selectors::{
    Element as SelectorsElement,
    matching::{ElementSelectorFlags, VisitedHandlingMode},
    sink::Push,
};

use super::{StyloElement, StyloNode};

// Stylo의 DOM trait은 이 상태 변경 메서드를 `unsafe` 시그니처로 요구한다.
// 구현 본문은 `Cell`과 Stylo의 안전한 데이터 wrapper만 사용한다.
impl<'a> TElement for StyloElement<'a> {
    type ConcreteNode = StyloNode<'a>;
    type TraversalChildrenIterator = std::vec::IntoIter<Self::ConcreteNode>;

    fn as_node(&self) -> StyloNode<'a> {
        StyloNode::new(self.view, Some(self.handle))
    }

    fn traversal_children(&self) -> LayoutIterator<Self::TraversalChildrenIterator> {
        let children = self
            .view
            .snapshot()
            .children(self.handle)
            .into_iter()
            .flatten()
            .filter(|handle| self.view.is_member(*handle))
            .map(|handle| StyloNode::new(self.view, Some(handle)))
            .collect::<Vec<_>>();
        LayoutIterator(children.into_iter())
    }

    fn is_html_element(&self) -> bool {
        super::element::atom_text(&self.data().namespace.0) == "http://www.w3.org/1999/xhtml"
    }

    fn is_mathml_element(&self) -> bool {
        super::element::atom_text(&self.data().namespace.0) == "http://www.w3.org/1998/Math/MathML"
    }

    fn is_svg_element(&self) -> bool {
        super::element::atom_text(&self.data().namespace.0) == "http://www.w3.org/2000/svg"
    }

    fn style_attribute(&self) -> Option<ArcBorrow<'_, Locked<PropertyDeclarationBlock>>> {
        self.data()
            .inline_style
            .as_ref()
            .map(|declarations| declarations.borrow_arc())
    }

    fn animation_rule(
        &self,
        _context: &SharedStyleContext,
    ) -> Option<Arc<Locked<PropertyDeclarationBlock>>> {
        None
    }

    fn transition_rule(
        &self,
        _context: &SharedStyleContext,
    ) -> Option<Arc<Locked<PropertyDeclarationBlock>>> {
        None
    }

    fn state(&self) -> stylo_dom::ElementState {
        self.data().state
    }

    fn has_part_attr(&self) -> bool {
        false
    }

    fn exports_any_part(&self) -> bool {
        false
    }

    fn id(&self) -> Option<&::style::Atom> {
        self.data().id.as_ref()
    }

    fn each_class<F>(&self, mut callback: F)
    where
        F: FnMut(&AtomIdent),
    {
        for class in &self.data().classes {
            callback(class);
        }
    }

    fn each_custom_state<F>(&self, _callback: F)
    where
        F: FnMut(&AtomIdent),
    {
    }

    fn each_attr_name<F>(&self, mut callback: F)
    where
        F: FnMut(&LocalName),
    {
        for attribute in &self.data().attributes {
            callback(&attribute.local_name);
        }
    }

    fn has_dirty_descendants(&self) -> bool {
        self.data().dirty_descendants.get()
    }

    fn has_snapshot(&self) -> bool {
        self.data().has_snapshot.get()
    }

    fn handled_snapshot(&self) -> bool {
        self.data().handled_snapshot.get()
    }

    #[allow(unsafe_code)]
    unsafe fn set_handled_snapshot(&self) {
        self.data().handled_snapshot.set(true);
    }

    #[allow(unsafe_code)]
    unsafe fn set_dirty_descendants(&self) {
        self.data().dirty_descendants.set(true);
    }

    #[allow(unsafe_code)]
    unsafe fn unset_dirty_descendants(&self) {
        self.data().dirty_descendants.set(false);
    }

    fn store_children_to_process(&self, count: isize) {
        self.data().children_to_process.set(count.max(0));
    }

    fn did_process_child(&self) -> isize {
        let remaining = self.data().children_to_process.get().saturating_sub(1);
        self.data().children_to_process.set(remaining);
        remaining
    }

    #[allow(unsafe_code)]
    unsafe fn ensure_data(&self) -> ElementDataMut<'_> {
        self.data().data_present.set(true);
        self.data().style_data.borrow_mut()
    }

    #[allow(unsafe_code)]
    unsafe fn clear_data(&self) {
        *self.data().style_data.borrow_mut() = ElementData::default();
        self.data().data_present.set(false);
    }

    fn has_data(&self) -> bool {
        self.data().data_present.get()
    }

    fn borrow_data(&self) -> Option<ElementDataRef<'_>> {
        self.has_data().then(|| self.data().style_data.borrow())
    }

    fn mutate_data(&self) -> Option<ElementDataMut<'_>> {
        self.has_data().then(|| self.data().style_data.borrow_mut())
    }

    fn skip_item_display_fixup(&self) -> bool {
        false
    }

    fn may_have_animations(&self) -> bool {
        false
    }

    fn has_animations(&self, _context: &SharedStyleContext) -> bool {
        false
    }

    fn has_css_animations(
        &self,
        _context: &SharedStyleContext,
        _pseudo_element: Option<PseudoElement>,
    ) -> bool {
        false
    }

    fn has_css_transitions(
        &self,
        _context: &SharedStyleContext,
        _pseudo_element: Option<PseudoElement>,
    ) -> bool {
        false
    }

    fn shadow_root(&self) -> Option<<Self::ConcreteNode as TNode>::ConcreteShadowRoot> {
        None
    }

    fn containing_shadow(&self) -> Option<<Self::ConcreteNode as TNode>::ConcreteShadowRoot> {
        None
    }

    fn lang_attr(&self) -> Option<AttrValue> {
        self.language_attribute()
            .map(|language| AttrValue::from(language.as_str()))
    }

    fn match_element_lang(
        &self,
        override_lang: Option<Option<AttrValue>>,
        requested: &Lang,
    ) -> bool {
        let mut current = Some(*self);
        let mut override_current = override_lang;
        while let Some(element) = current {
            let language = match override_current.take() {
                Some(Some(language)) => Some(language.as_ref().to_owned()),
                Some(None) => None,
                None => element.language_attribute(),
            };
            if let Some(language) = language {
                return language_matches(&language, requested);
            }
            current = element.parent_element();
        }
        false
    }

    fn is_html_document_body_element(&self) -> bool {
        self.view.is_html_document()
            && self.is_html_element()
            && super::element::atom_text(&self.data().local_name.0).eq_ignore_ascii_case("body")
    }

    fn synthesize_presentational_hints_for_legacy_attributes<V>(
        &self,
        _visited_handling: VisitedHandlingMode,
        _hints: &mut V,
    ) where
        V: Push<ApplicableDeclarationBlock>,
    {
    }

    fn local_name(&self) -> &<SelectorImpl as selectors::SelectorImpl>::BorrowedLocalName {
        &self.data().local_name.0
    }

    fn namespace(&self) -> &<SelectorImpl as selectors::SelectorImpl>::BorrowedNamespaceUrl {
        &self.data().namespace.0
    }

    fn query_container_size(
        &self,
        _display: &Display,
    ) -> euclid::default::Size2D<Option<app_units::Au>> {
        euclid::default::Size2D::new(None, None)
    }

    fn has_selector_flags(&self, flags: ElementSelectorFlags) -> bool {
        self.data().selector_flags.get().contains(flags)
    }

    fn relative_selector_search_direction(&self) -> ElementSelectorFlags {
        ElementSelectorFlags::empty()
    }

    fn get_attr(&self, attribute: &LocalName, namespace: &Namespace) -> Option<String> {
        self.attribute(namespace, attribute).map(str::to_owned)
    }
}

impl StyloElement<'_> {
    pub(super) fn language_attribute(self) -> Option<String> {
        let host = self.host_element();
        host.attributes()
            .iter()
            .find(|(name, _)| {
                name.namespace() == Some("http://www.w3.org/XML/1998/namespace")
                    && name.local_name() == "lang"
            })
            .or_else(|| {
                host.attributes()
                    .iter()
                    .find(|(name, _)| name.namespace().is_none() && name.local_name() == "lang")
            })
            .map(|(_, value)| value.to_string_lossy())
    }
}

fn language_matches(language: &str, requested: &str) -> bool {
    let language = language.trim();
    !requested.is_empty()
        && (language.eq_ignore_ascii_case(requested)
            || language
                .get(..requested.len())
                .is_some_and(|prefix| prefix.eq_ignore_ascii_case(requested))
                && language.as_bytes().get(requested.len()) == Some(&b'-'))
}
