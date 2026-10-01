use selectors::{
    Element as SelectorsElement,
    attr::{AttrSelectorOperation, CaseSensitivity, NamespaceConstraint},
    bloom::BloomFilter,
    matching::{ElementSelectorFlags, MatchingContext},
};
use style::dom::{TElement, TNode};
use style::selector_parser::{Lang, NonTSPseudoClass, SelectorImpl};
use style::{LocalName, Namespace};

use super::{
    StyloElement,
    element::{atom_text, attribute_name_matches},
};

impl SelectorsElement for StyloElement<'_> {
    type Impl = SelectorImpl;

    fn opaque(&self) -> selectors::OpaqueElement {
        let node = self
            .view
            .snapshot()
            .node(self.handle)
            .expect("Stylo 요소의 HostNode가 있어야 합니다");
        selectors::OpaqueElement::new(node)
    }

    fn parent_element(&self) -> Option<Self> {
        self.as_node().parent_element()
    }

    fn parent_node_is_shadow_root(&self) -> bool {
        false
    }

    fn containing_shadow_host(&self) -> Option<Self> {
        None
    }

    fn is_pseudo_element(&self) -> bool {
        false
    }

    fn prev_sibling_element(&self) -> Option<Self> {
        let mut sibling = self.as_node().prev_sibling();
        while let Some(node) = sibling {
            if let Some(element) = node.as_element() {
                return Some(element);
            }
            sibling = node.prev_sibling();
        }
        None
    }

    fn next_sibling_element(&self) -> Option<Self> {
        let mut sibling = self.as_node().next_sibling();
        while let Some(node) = sibling {
            if let Some(element) = node.as_element() {
                return Some(element);
            }
            sibling = node.next_sibling();
        }
        None
    }

    fn first_element_child(&self) -> Option<Self> {
        let mut child = self.as_node().first_child();
        while let Some(node) = child {
            if let Some(element) = node.as_element() {
                return Some(element);
            }
            child = node.next_sibling();
        }
        None
    }

    fn is_html_element_in_html_document(&self) -> bool {
        self.view.is_html_document()
            && atom_text(&self.data().namespace.0) == "http://www.w3.org/1999/xhtml"
    }

    fn has_local_name(
        &self,
        local_name: &<Self::Impl as selectors::SelectorImpl>::BorrowedLocalName,
    ) -> bool {
        let current = atom_text(&self.data().local_name.0);
        let expected = atom_text(local_name);
        if self.is_html_element_in_html_document() {
            current.eq_ignore_ascii_case(expected)
        } else {
            current == expected
        }
    }

    fn has_namespace(
        &self,
        namespace: &<Self::Impl as selectors::SelectorImpl>::BorrowedNamespaceUrl,
    ) -> bool {
        atom_text(&self.data().namespace.0) == atom_text(namespace)
    }

    fn is_same_type(&self, other: &Self) -> bool {
        self.has_namespace(&other.data().namespace.0)
            && self.has_local_name(&other.data().local_name.0)
    }

    fn attr_matches(
        &self,
        namespace: &NamespaceConstraint<&<Self::Impl as selectors::SelectorImpl>::NamespaceUrl>,
        local_name: &<Self::Impl as selectors::SelectorImpl>::LocalName,
        operation: &AttrSelectorOperation<&<Self::Impl as selectors::SelectorImpl>::AttrValue>,
    ) -> bool {
        let expected_name = LocalName::from(atom_text(&local_name.0));
        self.data().attributes.iter().any(|attribute| {
            let namespace_matches = match namespace {
                NamespaceConstraint::Any => true,
                NamespaceConstraint::Specific(expected) => {
                    atom_text(&attribute.namespace.0) == atom_text(&expected.0)
                }
            };
            let insensitive_html_attribute_name = self.is_html_element_in_html_document()
                && atom_text(&attribute.namespace.0).is_empty();
            let local_name_matches = attribute.local_name == expected_name
                || insensitive_html_attribute_name
                    && attribute_name_matches(
                        &attribute.local_name,
                        atom_text(&expected_name.0),
                        true,
                    );
            namespace_matches && local_name_matches && operation.eval_str(&attribute.value)
        })
    }

    fn match_non_ts_pseudo_class(
        &self,
        pseudo: &<Self::Impl as selectors::SelectorImpl>::NonTSPseudoClass,
        _context: &mut MatchingContext<Self::Impl>,
    ) -> bool {
        match pseudo {
            NonTSPseudoClass::Active => self.has_state(stylo_dom::ElementState::ACTIVE),
            NonTSPseudoClass::Checked => self.has_state(stylo_dom::ElementState::CHECKED),
            NonTSPseudoClass::Disabled => self.has_state(stylo_dom::ElementState::DISABLED),
            NonTSPseudoClass::Focus => self.has_state(stylo_dom::ElementState::FOCUS),
            NonTSPseudoClass::FocusVisible => self.has_state(stylo_dom::ElementState::FOCUSRING),
            NonTSPseudoClass::FocusWithin => self.subtree_has_focus(),
            NonTSPseudoClass::Hover => self.has_state(stylo_dom::ElementState::HOVER),
            NonTSPseudoClass::AnyLink | NonTSPseudoClass::Link => self.is_link(),
            NonTSPseudoClass::Lang(language) => self.matches_language(language),
            _ => false,
        }
    }

    fn match_pseudo_element(
        &self,
        _pseudo: &<Self::Impl as selectors::SelectorImpl>::PseudoElement,
        _context: &mut MatchingContext<Self::Impl>,
    ) -> bool {
        false
    }

    fn apply_selector_flags(&self, flags: ElementSelectorFlags) {
        self.data()
            .selector_flags
            .set(self.data().selector_flags.get() | flags);
    }

    fn is_link(&self) -> bool {
        self.is_html_element_in_html_document()
            && matches!(
                atom_text(&self.data().local_name.0)
                    .to_ascii_lowercase()
                    .as_str(),
                "a" | "area" | "link"
            )
            && self
                .attribute(&Namespace::from(""), &LocalName::from("href"))
                .is_some()
    }

    fn is_html_slot_element(&self) -> bool {
        self.is_html_element_in_html_document()
            && atom_text(&self.data().local_name.0).eq_ignore_ascii_case("slot")
    }

    fn has_id(
        &self,
        id: &<Self::Impl as selectors::SelectorImpl>::Identifier,
        case: CaseSensitivity,
    ) -> bool {
        self.data().id.as_ref().is_some_and(|current| match case {
            CaseSensitivity::CaseSensitive => current == &id.0,
            CaseSensitivity::AsciiCaseInsensitive => current.eq_ignore_ascii_case(&id.0),
        })
    }

    fn has_class(
        &self,
        name: &<Self::Impl as selectors::SelectorImpl>::Identifier,
        case: CaseSensitivity,
    ) -> bool {
        self.data().classes.iter().any(|class| match case {
            CaseSensitivity::CaseSensitive => class == name,
            CaseSensitivity::AsciiCaseInsensitive => class.eq_ignore_ascii_case(name),
        })
    }

    fn has_custom_state(
        &self,
        _name: &<Self::Impl as selectors::SelectorImpl>::Identifier,
    ) -> bool {
        false
    }

    fn imported_part(
        &self,
        _name: &<Self::Impl as selectors::SelectorImpl>::Identifier,
    ) -> Option<<Self::Impl as selectors::SelectorImpl>::Identifier> {
        None
    }

    fn is_part(&self, _name: &<Self::Impl as selectors::SelectorImpl>::Identifier) -> bool {
        false
    }

    fn is_empty(&self) -> bool {
        self.view
            .snapshot()
            .children(self.handle)
            .into_iter()
            .flatten()
            .filter(|handle| self.view.is_member(*handle))
            .all(|handle| {
                self.view
                    .snapshot()
                    .node(handle)
                    .is_some_and(|node| match node.kind() {
                        spinon_core::HostNodeKind::Element(_) => false,
                        spinon_core::HostNodeKind::Text(text) => text.code_units().is_empty(),
                    })
            })
    }

    fn is_root(&self) -> bool {
        self.handle == self.view.root_handle()
    }

    fn add_element_unique_hashes(&self, _filter: &mut BloomFilter) -> bool {
        false
    }
}

impl StyloElement<'_> {
    fn subtree_has_focus(self) -> bool {
        if self.has_state(stylo_dom::ElementState::FOCUS) {
            return true;
        }
        let mut pending = self
            .view
            .snapshot()
            .children(self.handle)
            .into_iter()
            .flatten()
            .filter(|handle| self.view.is_member(*handle))
            .collect::<Vec<_>>();
        while let Some(handle) = pending.pop() {
            if let Some(element) = self.view.element(handle)
                && element.has_state(stylo_dom::ElementState::FOCUS)
            {
                return true;
            }
            pending.extend(
                self.view
                    .snapshot()
                    .children(handle)
                    .into_iter()
                    .flatten()
                    .filter(|child| self.view.is_member(*child)),
            );
        }
        false
    }

    fn matches_language(self, requested: &Lang) -> bool {
        let requested = requested.as_ref();
        if requested.is_empty() {
            return false;
        }
        let mut current = Some(self);
        while let Some(element) = current {
            if let Some(language) = element.language_attribute() {
                let language = language.trim();
                return language.eq_ignore_ascii_case(requested)
                    || language
                        .get(..requested.len())
                        .is_some_and(|prefix| prefix.eq_ignore_ascii_case(requested))
                        && language.as_bytes().get(requested.len()) == Some(&b'-');
            }
            current = element.parent_element();
        }
        false
    }
}
