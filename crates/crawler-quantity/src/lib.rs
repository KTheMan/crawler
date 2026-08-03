//! Exact stored quantities and deterministic, field-aware parsing for Crawler.

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum QuantityKind {
    Length,
    Angle,
    Count,
    Scalar,
    Tolerance,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum Quantity {
    LengthNanometers(i64),
    AngleMicrodegrees(i64),
    Count(u64),
    ScalarMillionths(i64),
    ToleranceNanometers(u64),
}

impl Quantity {
    pub const fn kind(self) -> QuantityKind {
        match self {
            Self::LengthNanometers(_) => QuantityKind::Length,
            Self::AngleMicrodegrees(_) => QuantityKind::Angle,
            Self::Count(_) => QuantityKind::Count,
            Self::ScalarMillionths(_) => QuantityKind::Scalar,
            Self::ToleranceNanometers(_) => QuantityKind::Tolerance,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Unit {
    Nanometer,
    Micrometer,
    Millimeter,
    Centimeter,
    Meter,
    Inch,
    Foot,
    Microdegree,
    Degree,
    Radian,
    Unitless,
    Percent,
}

impl Unit {
    fn parse(suffix: &str) -> Option<Self> {
        match suffix.trim().to_ascii_lowercase().as_str() {
            "nm" => Some(Self::Nanometer),
            "um" | "µm" => Some(Self::Micrometer),
            "mm" => Some(Self::Millimeter),
            "cm" => Some(Self::Centimeter),
            "m" => Some(Self::Meter),
            "in" | "inch" | "inches" | "\"" => Some(Self::Inch),
            "ft" | "foot" | "feet" | "'" => Some(Self::Foot),
            "udeg" | "µdeg" => Some(Self::Microdegree),
            "deg" | "°" => Some(Self::Degree),
            "rad" => Some(Self::Radian),
            "%" => Some(Self::Percent),
            "" => Some(Self::Unitless),
            _ => None,
        }
    }

    const fn kind(self) -> Option<QuantityKind> {
        match self {
            Self::Nanometer
            | Self::Micrometer
            | Self::Millimeter
            | Self::Centimeter
            | Self::Meter
            | Self::Inch
            | Self::Foot => Some(QuantityKind::Length),
            Self::Microdegree | Self::Degree | Self::Radian => Some(QuantityKind::Angle),
            Self::Unitless | Self::Percent => None,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Error)]
#[error("{code:?} in field {field}: {message}")]
pub struct QuantityError {
    pub code: QuantityErrorCode,
    pub field: String,
    pub expected: QuantityKind,
    pub message: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum QuantityErrorCode {
    InvalidNumber,
    UnknownUnit,
    MissingUnit,
    IncompatibleUnit,
    NonIntegralCount,
    NegativeTolerance,
    OutOfRange,
}

/// Parse a dimensional field without using binary floating-point arithmetic.
pub fn parse_quantity(
    field: impl Into<String>,
    text: &str,
    expected: QuantityKind,
) -> Result<Quantity, QuantityError> {
    let field = field.into();
    let (number, suffix) = split_number_and_unit(text).ok_or_else(|| {
        error(
            &field,
            expected,
            QuantityErrorCode::InvalidNumber,
            "enter a decimal number followed by a compatible unit",
        )
    })?;
    let unit = Unit::parse(suffix).ok_or_else(|| {
        error(
            &field,
            expected,
            QuantityErrorCode::UnknownUnit,
            &format!("unknown unit {suffix:?}"),
        )
    })?;
    let decimal = Decimal::parse(number).ok_or_else(|| {
        error(
            &field,
            expected,
            QuantityErrorCode::InvalidNumber,
            "the numeric value is not a supported decimal",
        )
    })?;

    match expected {
        QuantityKind::Length => {
            require_unit_kind(&field, expected, unit, QuantityKind::Length)?;
            let value = scaled_i64(&field, expected, decimal, length_nanometers(unit)?)?;
            Ok(Quantity::LengthNanometers(value))
        }
        QuantityKind::Tolerance => {
            require_unit_kind(&field, expected, unit, QuantityKind::Length)?;
            let value = scaled_i64(&field, expected, decimal, length_nanometers(unit)?)?;
            let value = u64::try_from(value).map_err(|_| {
                error(
                    &field,
                    expected,
                    QuantityErrorCode::NegativeTolerance,
                    "tolerance must not be negative",
                )
            })?;
            Ok(Quantity::ToleranceNanometers(value))
        }
        QuantityKind::Angle => {
            require_unit_kind(&field, expected, unit, QuantityKind::Angle)?;
            let value = match unit {
                Unit::Microdegree => scaled_i64(&field, expected, decimal, 1)?,
                Unit::Degree => scaled_i64(&field, expected, decimal, 1_000_000)?,
                Unit::Radian => radians_to_microdegrees(&field, decimal)?,
                _ => unreachable!(),
            };
            Ok(Quantity::AngleMicrodegrees(value))
        }
        QuantityKind::Count => {
            if unit != Unit::Unitless {
                return Err(error(
                    &field,
                    expected,
                    QuantityErrorCode::IncompatibleUnit,
                    "count must not have a unit",
                ));
            }
            if decimal.scale != 1 || decimal.mantissa < 0 {
                return Err(error(
                    &field,
                    expected,
                    QuantityErrorCode::NonIntegralCount,
                    "count must be a non-negative whole number",
                ));
            }
            Ok(Quantity::Count(u64::try_from(decimal.mantissa).map_err(
                |_| {
                    error(
                        &field,
                        expected,
                        QuantityErrorCode::OutOfRange,
                        "count is out of range",
                    )
                },
            )?))
        }
        QuantityKind::Scalar => {
            let factor = match unit {
                Unit::Unitless => 1_000_000,
                Unit::Percent => 10_000,
                _ => {
                    return Err(error(
                        &field,
                        expected,
                        QuantityErrorCode::IncompatibleUnit,
                        "scalar accepts no unit or percent",
                    ));
                }
            };
            Ok(Quantity::ScalarMillionths(scaled_i64(
                &field, expected, decimal, factor,
            )?))
        }
    }
}

fn split_number_and_unit(text: &str) -> Option<(&str, &str)> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }
    let mut boundary = trimmed.len();
    for (index, character) in trimmed.char_indices() {
        if !(character.is_ascii_digit()
            || matches!(character, '+' | '-' | '.' | '_')
            || character.is_ascii_whitespace())
        {
            boundary = index;
            break;
        }
    }
    let number = trimmed[..boundary].trim();
    (!number.is_empty()).then_some((number, trimmed[boundary..].trim()))
}

#[derive(Clone, Copy, Debug)]
struct Decimal {
    mantissa: i128,
    scale: i128,
}

impl Decimal {
    fn parse(input: &str) -> Option<Self> {
        let compact = input.replace([' ', '_'], "");
        let (negative, unsigned) = match compact.strip_prefix('-') {
            Some(rest) => (true, rest),
            None => (false, compact.strip_prefix('+').unwrap_or(&compact)),
        };
        let mut pieces = unsigned.split('.');
        let whole = pieces.next()?;
        let fraction = pieces.next().unwrap_or("");
        if pieces.next().is_some()
            || (whole.is_empty() && fraction.is_empty())
            || !whole.chars().all(|value| value.is_ascii_digit())
            || !fraction.chars().all(|value| value.is_ascii_digit())
            || fraction.len() > 12
        {
            return None;
        }
        let digits = format!("{}{}", if whole.is_empty() { "0" } else { whole }, fraction);
        let mut mantissa = digits.parse::<i128>().ok()?;
        if negative {
            mantissa = -mantissa;
        }
        Some(Self {
            mantissa,
            scale: 10_i128.checked_pow(fraction.len() as u32)?,
        })
    }
}

fn require_unit_kind(
    field: &str,
    expected: QuantityKind,
    unit: Unit,
    unit_kind: QuantityKind,
) -> Result<(), QuantityError> {
    match unit.kind() {
        None => Err(error(
            field,
            expected,
            QuantityErrorCode::MissingUnit,
            "this field requires an explicit unit",
        )),
        Some(actual) if actual != unit_kind => Err(error(
            field,
            expected,
            QuantityErrorCode::IncompatibleUnit,
            "the supplied unit has the wrong dimension",
        )),
        Some(_) => Ok(()),
    }
}

fn length_nanometers(unit: Unit) -> Result<i128, QuantityError> {
    Ok(match unit {
        Unit::Nanometer => 1,
        Unit::Micrometer => 1_000,
        Unit::Millimeter => 1_000_000,
        Unit::Centimeter => 10_000_000,
        Unit::Meter => 1_000_000_000,
        Unit::Inch => 25_400_000,
        Unit::Foot => 304_800_000,
        _ => unreachable!(),
    })
}

fn scaled_i64(
    field: &str,
    expected: QuantityKind,
    decimal: Decimal,
    factor: i128,
) -> Result<i64, QuantityError> {
    let numerator = decimal.mantissa.checked_mul(factor).ok_or_else(|| {
        error(
            field,
            expected,
            QuantityErrorCode::OutOfRange,
            "value is out of range",
        )
    })?;
    if numerator % decimal.scale != 0 {
        return Err(error(
            field,
            expected,
            QuantityErrorCode::InvalidNumber,
            "value is more precise than the stored base unit",
        ));
    }
    i64::try_from(numerator / decimal.scale).map_err(|_| {
        error(
            field,
            expected,
            QuantityErrorCode::OutOfRange,
            "value is out of range",
        )
    })
}

fn radians_to_microdegrees(field: &str, decimal: Decimal) -> Result<i64, QuantityError> {
    // π rounded to 15 decimal places. Integer arithmetic makes conversion stable
    // across native and WASM targets; the stored result remains exact microdegrees.
    const PI_SCALED: i128 = 3_141_592_653_589_793;
    const PI_SCALE: i128 = 1_000_000_000_000_000;
    let numerator = decimal
        .mantissa
        .checked_mul(180_000_000)
        .and_then(|value| value.checked_mul(PI_SCALE))
        .ok_or_else(|| {
            error(
                field,
                QuantityKind::Angle,
                QuantityErrorCode::OutOfRange,
                "angle is out of range",
            )
        })?;
    let denominator = decimal.scale.checked_mul(PI_SCALED).unwrap();
    let rounded = if numerator >= 0 {
        (numerator + denominator / 2) / denominator
    } else {
        (numerator - denominator / 2) / denominator
    };
    i64::try_from(rounded).map_err(|_| {
        error(
            field,
            QuantityKind::Angle,
            QuantityErrorCode::OutOfRange,
            "angle is out of range",
        )
    })
}

fn error(
    field: &str,
    expected: QuantityKind,
    code: QuantityErrorCode,
    message: &str,
) -> QuantityError {
    QuantityError {
        code,
        field: field.to_owned(),
        expected,
        message: message.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn equivalent_display_units_produce_identical_semantic_lengths() {
        let millimeters = parse_quantity("width", "25.4 mm", QuantityKind::Length).unwrap();
        let inches = parse_quantity("width", "1 in", QuantityKind::Length).unwrap();
        assert_eq!(millimeters, inches);
        assert_eq!(inches, Quantity::LengthNanometers(25_400_000));
    }

    #[test]
    fn every_alpha_quantity_uses_an_exact_stored_representation() {
        assert_eq!(
            parse_quantity("angle", "90 deg", QuantityKind::Angle).unwrap(),
            Quantity::AngleMicrodegrees(90_000_000)
        );
        assert_eq!(
            parse_quantity("count", "12", QuantityKind::Count).unwrap(),
            Quantity::Count(12)
        );
        assert_eq!(
            parse_quantity("scale", "12.5%", QuantityKind::Scalar).unwrap(),
            Quantity::ScalarMillionths(125_000)
        );
        assert_eq!(
            parse_quantity("tolerance", "0.001 mm", QuantityKind::Tolerance).unwrap(),
            Quantity::ToleranceNanometers(1_000)
        );
    }

    #[test]
    fn incompatible_units_report_the_responsible_field() {
        let error = parse_quantity("extrude.distance", "5 deg", QuantityKind::Length).unwrap_err();
        assert_eq!(error.code, QuantityErrorCode::IncompatibleUnit);
        assert_eq!(error.field, "extrude.distance");
        assert_eq!(error.expected, QuantityKind::Length);
    }

    #[test]
    fn serde_roundtrip_preserves_exact_values() {
        let quantity = parse_quantity("width", "10.125 mm", QuantityKind::Length).unwrap();
        let encoded = serde_json::to_string(&quantity).unwrap();
        assert_eq!(
            serde_json::from_str::<Quantity>(&encoded).unwrap(),
            quantity
        );
    }
}
