use cssparser::{Delimiter, Parser, Token};

/// S04가 허용하는 작성자 `background-color` 형식은 6자리 hex 색상뿐입니다.
pub(super) fn first_invalid_background_color(css: &str) -> Option<String> {
    let mut parser = Parser::new(css);

    while !parser.is_exhausted() {
        parser.skip_whitespace();
        if parser.is_exhausted() {
            break;
        }
        if parser
            .parse_until_before(Delimiter::CurlyBracketBlock, drain_tokens)
            .is_err()
        {
            return Some("stylesheet 규칙 prelude를 읽을 수 없습니다".to_owned());
        }
        match parser.next() {
            Ok(Token::CurlyBracketBlock) => {
                let mut invalid_color = false;
                if parser
                    .parse_nested_block(|block| parse_declarations(block, &mut invalid_color))
                    .is_err()
                {
                    return Some("stylesheet 선언 블록을 읽을 수 없습니다".to_owned());
                }
                if invalid_color {
                    return Some(
                        "S04 background-color 값은 불투명한 #RRGGBB 여섯 자리 hex여야 합니다"
                            .to_owned(),
                    );
                }
            }
            _ => return Some("stylesheet 규칙에 선언 블록이 없습니다".to_owned()),
        }
    }
    None
}

fn parse_declarations<'i>(
    parser: &mut Parser<'i>,
    invalid_color: &mut bool,
) -> Result<(), cssparser::ParseError<()>> {
    loop {
        parser.skip_whitespace();
        if parser.is_exhausted() {
            return Ok(());
        }
        if parser.try_parse(|parser| parser.expect_semicolon()).is_ok() {
            continue;
        }

        let property = match parser.expect_ident() {
            Ok(property) => property.to_string(),
            Err(_) => {
                *invalid_color = true;
                drain_tokens(parser)?;
                return Ok(());
            }
        };
        parser.skip_whitespace();
        if parser.expect_colon().is_err() {
            *invalid_color = true;
            drain_tokens(parser)?;
            return Ok(());
        }

        let is_background_color = property.eq_ignore_ascii_case("background-color");
        parser.parse_until_after(Delimiter::Semicolon, |value| {
            if is_background_color && !is_single_six_digit_hex(value) {
                *invalid_color = true;
            }
            drain_tokens(value)
        })?;
    }
}

fn is_single_six_digit_hex(parser: &mut Parser<'_>) -> bool {
    parser.skip_whitespace();
    let valid = match parser.next_including_whitespace_and_comments() {
        Ok(Token::Hash(value) | Token::IDHash(value)) => {
            value.len() == 6 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
        }
        _ => false,
    };
    parser.skip_whitespace();
    let has_extra_tokens = !parser.is_exhausted();
    !has_extra_tokens && valid
}

fn drain_tokens<'i>(parser: &mut Parser<'i>) -> Result<(), cssparser::ParseError<()>> {
    while !parser.is_exhausted() {
        match parser.next_including_whitespace_and_comments()? {
            Token::Function(_)
            | Token::ParenthesisBlock
            | Token::CurlyBracketBlock
            | Token::SquareBracketBlock => parser.parse_nested_block(drain_tokens)?,
            _ => {}
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::first_invalid_background_color;

    #[test]
    fn permits_only_opaque_six_digit_hex_background_colors() {
        assert_eq!(
            first_invalid_background_color("#a { background-color: #e11d48; }"),
            None
        );
        assert!(
            first_invalid_background_color("#a { background-color: rgb(225 29 72); }").is_some()
        );
        assert!(first_invalid_background_color("#a { background-color: #e11d4880; }").is_some());
        assert!(
            first_invalid_background_color("#a { background-color: #e11d48 !important; }")
                .is_some()
        );
    }

    #[test]
    fn ignores_comments_and_non_color_values_while_scanning() {
        assert_eq!(
            first_invalid_background_color(
                "/* { background-color: rgb(0 0 0); } */ #a { width: calc(10px + 2px); background-color: #112233; }"
            ),
            None
        );
    }
}
