use style::color::AbsoluteColor;

/// 불투명한 encoded sRGB 색입니다. CSS `#RRGGBB` paint 경계에서 사용합니다.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct OpaqueCssSrgb {
    pub red: u8,
    pub green: u8,
    pub blue: u8,
}

impl OpaqueCssSrgb {
    pub(crate) fn from_absolute_color(color: AbsoluteColor) -> Result<Self, &'static str> {
        let color = color.into_srgb_legacy();
        let [red, green, blue, alpha] = *color.raw_components();
        if alpha != 1.0 {
            return Err("computed background-color alpha가 1이 아닙니다");
        }

        Ok(Self {
            red: to_srgb_byte(red)?,
            green: to_srgb_byte(green)?,
            blue: to_srgb_byte(blue)?,
        })
    }
}

fn to_srgb_byte(component: f32) -> Result<u8, &'static str> {
    if !component.is_finite() || !(0.0..=1.0).contains(&component) {
        return Err("computed sRGB 채널이 유한한 0..1 값이 아닙니다");
    }
    Ok((component * 255.0).round() as u8)
}

#[cfg(test)]
mod tests {
    use style::color::AbsoluteColor;

    use super::OpaqueCssSrgb;

    #[test]
    fn encoded_srgb_bytes_are_preserved() {
        let color = AbsoluteColor::srgb_legacy(0x11, 0x28, 0x39, 1.0);
        assert_eq!(
            OpaqueCssSrgb::from_absolute_color(color),
            Ok(OpaqueCssSrgb {
                red: 0x11,
                green: 0x28,
                blue: 0x39,
            })
        );
    }

    #[test]
    fn transparency_is_rejected() {
        let color = AbsoluteColor::srgb_legacy(255, 0, 0, 0.5);
        assert_eq!(
            OpaqueCssSrgb::from_absolute_color(color),
            Err("computed background-color alpha가 1이 아닙니다")
        );
    }
}
