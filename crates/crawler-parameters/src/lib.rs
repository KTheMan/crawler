//! Stable named parameters and deterministic, unit-safe expression evaluation.

use std::collections::BTreeMap;

use crawler_quantity::{Quantity, QuantityError, QuantityKind, parse_quantity};
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Stable semantic identity, independent of a parameter's display name.
#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct NamedParameterId(pub String);

impl From<&str> for NamedParameterId {
    fn from(value: &str) -> Self {
        Self(value.to_owned())
    }
}

/// Stored expression retains user source and a structural, rename-safe AST.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ParameterExpression {
    pub source: String,
    pub root: ExpressionNode,
}

/// Exact expression operations supported by the alpha parameter graph.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ExpressionNode {
    Literal { value: Quantity },
    Parameter { id: NamedParameterId },
    Add { left: Box<Self>, right: Box<Self> },
    Subtract { left: Box<Self>, right: Box<Self> },
    Multiply { value: Box<Self>, scalar: Box<Self> },
    Divide { value: Box<Self>, scalar: Box<Self> },
}

/// One reusable exact design value.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct NamedParameter {
    pub id: NamedParameterId,
    pub display_name: String,
    pub kind: QuantityKind,
    pub expression: ParameterExpression,
}

/// A field promoted to, or driven by, a stable named parameter.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct FieldBinding {
    pub field_id: String,
    pub parameter: NamedParameterId,
}

/// Canonically ordered parameter definitions and field bindings.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct ParameterSet {
    pub parameters: BTreeMap<NamedParameterId, NamedParameter>,
    pub field_bindings: BTreeMap<String, FieldBinding>,
}

/// Evaluation output retains both the entered expression and exact result.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EvaluatedParameter {
    pub id: NamedParameterId,
    pub source: String,
    pub value: Quantity,
}

/// Byte offsets into the original expression source. Offsets are stable across
/// native and WASM builds because the parser only advances at UTF-8 boundaries.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ExpressionSpan {
    pub start: usize,
    pub end: usize,
}

/// Stable categories suitable for field-level validation UI.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ParameterDiagnosticCode {
    EmptyExpression,
    UnexpectedToken,
    MissingClosingParenthesis,
    UnknownName,
    AmbiguousName,
    InvalidQuantity,
    KindMismatch,
    IncompatibleOperands,
    ExpectedScalar,
    DivisionByZero,
    InexactOrOverflow,
    Cycle,
    Evaluation,
}

/// A deterministic diagnostic tied to the operation field being edited.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Error)]
#[error("{code:?} in field {field}: {message}")]
pub struct ParameterDiagnostic {
    pub code: ParameterDiagnosticCode,
    pub field: String,
    pub span: Option<ExpressionSpan>,
    pub message: Box<str>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub candidates: Vec<NamedParameterId>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cycle: Vec<NamedParameterId>,
}

impl ParameterSet {
    /// Compile user-entered text into a rename-safe expression. Display names
    /// are resolved once; the stored tree contains only stable parameter IDs.
    pub fn parse_expression(
        &self,
        field: impl Into<String>,
        source: impl Into<String>,
        expected: QuantityKind,
    ) -> Result<ParameterExpression, ParameterDiagnostic> {
        let field = field.into();
        let source = source.into();
        let raw = SourceParser::new(&field, &source).parse()?;
        let root = self.compile_node(&field, &source, &raw, expected)?;
        Ok(ParameterExpression { source, root })
    }

    /// Parse and apply an expression atomically. Parsing, type checking, cycle
    /// detection, and exact evaluation all complete before a candidate is
    /// returned, so callers never need to roll back a failed edit.
    pub fn set_expression_source(
        &self,
        id: &NamedParameterId,
        field: impl Into<String>,
        source: impl Into<String>,
    ) -> Result<Self, ParameterDiagnostic> {
        let field = field.into();
        let expected = self
            .parameters
            .get(id)
            .ok_or_else(|| {
                diagnostic(
                    &field,
                    ParameterDiagnosticCode::UnknownName,
                    None,
                    format!("unknown parameter id {:?}", id.0),
                )
            })?
            .kind;
        let expression = self.parse_expression(&field, source, expected)?;
        self.set_expression(id, expression)
            .map_err(|error| evaluation_diagnostic(&field, error))
    }

    /// Return the exact value together with the original entered source.
    pub fn evaluated_parameter(
        &self,
        id: &NamedParameterId,
    ) -> Result<EvaluatedParameter, ParameterError> {
        self.evaluate_all()?
            .remove(id)
            .ok_or_else(|| ParameterError::UnknownParameter(id.clone()))
    }

    /// Promote a field's current exact value without deriving identity from its
    /// mutable display name or storage order.
    pub fn promote_field(
        &self,
        field_id: impl Into<String>,
        parameter_id: NamedParameterId,
        display_name: impl Into<String>,
        current_value: Quantity,
    ) -> Result<Self, ParameterError> {
        if parameter_id.0.trim().is_empty() {
            return Err(ParameterError::InvalidId);
        }
        if self.parameters.contains_key(&parameter_id) {
            return Err(ParameterError::DuplicateParameter(parameter_id));
        }
        let field_id = field_id.into();
        if field_id.trim().is_empty() {
            return Err(ParameterError::InvalidField);
        }
        let display_name = display_name.into();
        if display_name.trim().is_empty() {
            return Err(ParameterError::InvalidName);
        }
        let mut candidate = self.clone();
        candidate.parameters.insert(
            parameter_id.clone(),
            NamedParameter {
                id: parameter_id.clone(),
                display_name,
                kind: current_value.kind(),
                expression: ParameterExpression {
                    source: format_quantity(current_value),
                    root: ExpressionNode::Literal {
                        value: current_value,
                    },
                },
            },
        );
        candidate.field_bindings.insert(
            field_id.clone(),
            FieldBinding {
                field_id,
                parameter: parameter_id,
            },
        );
        candidate.evaluate_all()?;
        Ok(candidate)
    }

    /// Replace a definition atomically. Failed evaluation returns no candidate.
    pub fn set_expression(
        &self,
        id: &NamedParameterId,
        expression: ParameterExpression,
    ) -> Result<Self, ParameterError> {
        let mut candidate = self.clone();
        candidate
            .parameters
            .get_mut(id)
            .ok_or_else(|| ParameterError::UnknownParameter(id.clone()))?
            .expression = expression;
        candidate.evaluate_all()?;
        Ok(candidate)
    }

    /// Rename does not rewrite structural references and therefore cannot break
    /// dependencies. Display text is rendered from the current name map.
    pub fn rename(
        &self,
        id: &NamedParameterId,
        display_name: impl Into<String>,
    ) -> Result<Self, ParameterError> {
        let display_name = display_name.into();
        if display_name.trim().is_empty() {
            return Err(ParameterError::InvalidName);
        }
        let mut candidate = self.clone();
        candidate
            .parameters
            .get_mut(id)
            .ok_or_else(|| ParameterError::UnknownParameter(id.clone()))?
            .display_name = display_name;
        Ok(candidate)
    }

    pub fn evaluate_all(
        &self,
    ) -> Result<BTreeMap<NamedParameterId, EvaluatedParameter>, ParameterError> {
        let mut values = BTreeMap::new();
        let mut stack = Vec::new();
        for id in self.parameters.keys() {
            self.evaluate_parameter(id, &mut values, &mut stack)?;
        }
        Ok(values)
    }

    pub fn field_value(&self, field_id: &str) -> Result<Quantity, ParameterError> {
        let binding = self
            .field_bindings
            .get(field_id)
            .ok_or_else(|| ParameterError::UnknownField(field_id.to_owned()))?;
        Ok(self.evaluate_all()?[&binding.parameter].value)
    }

    pub fn display_expression(&self, id: &NamedParameterId) -> Result<String, ParameterError> {
        let parameter = self
            .parameters
            .get(id)
            .ok_or_else(|| ParameterError::UnknownParameter(id.clone()))?;
        self.display_node(&parameter.expression.root)
    }

    fn evaluate_parameter(
        &self,
        id: &NamedParameterId,
        values: &mut BTreeMap<NamedParameterId, EvaluatedParameter>,
        stack: &mut Vec<NamedParameterId>,
    ) -> Result<Quantity, ParameterError> {
        if let Some(value) = values.get(id) {
            return Ok(value.value);
        }
        if let Some(start) = stack.iter().position(|candidate| candidate == id) {
            let mut path = stack[start..].to_vec();
            path.push(id.clone());
            return Err(ParameterError::Cycle { path });
        }
        let parameter = self
            .parameters
            .get(id)
            .ok_or_else(|| ParameterError::UnknownParameter(id.clone()))?;
        stack.push(id.clone());
        let value = self.evaluate_node(&parameter.expression.root, values, stack)?;
        stack.pop();
        if value.kind() != parameter.kind {
            return Err(ParameterError::KindMismatch {
                parameter: id.clone(),
                expected: parameter.kind,
                actual: value.kind(),
            });
        }
        values.insert(
            id.clone(),
            EvaluatedParameter {
                id: id.clone(),
                source: parameter.expression.source.clone(),
                value,
            },
        );
        Ok(value)
    }

    fn evaluate_node(
        &self,
        node: &ExpressionNode,
        values: &mut BTreeMap<NamedParameterId, EvaluatedParameter>,
        stack: &mut Vec<NamedParameterId>,
    ) -> Result<Quantity, ParameterError> {
        match node {
            ExpressionNode::Literal { value } => Ok(*value),
            ExpressionNode::Parameter { id } => self.evaluate_parameter(id, values, stack),
            ExpressionNode::Add { left, right } => add(
                self.evaluate_node(left, values, stack)?,
                self.evaluate_node(right, values, stack)?,
            ),
            ExpressionNode::Subtract { left, right } => subtract(
                self.evaluate_node(left, values, stack)?,
                self.evaluate_node(right, values, stack)?,
            ),
            ExpressionNode::Multiply { value, scalar } => scale(
                self.evaluate_node(value, values, stack)?,
                self.evaluate_node(scalar, values, stack)?,
                false,
            ),
            ExpressionNode::Divide { value, scalar } => scale(
                self.evaluate_node(value, values, stack)?,
                self.evaluate_node(scalar, values, stack)?,
                true,
            ),
        }
    }

    fn display_node(&self, node: &ExpressionNode) -> Result<String, ParameterError> {
        Ok(match node {
            ExpressionNode::Literal { value } => format_quantity(*value),
            ExpressionNode::Parameter { id } => self
                .parameters
                .get(id)
                .ok_or_else(|| ParameterError::UnknownParameter(id.clone()))?
                .display_name
                .clone(),
            ExpressionNode::Add { left, right } => format!(
                "({} + {})",
                self.display_node(left)?,
                self.display_node(right)?
            ),
            ExpressionNode::Subtract { left, right } => format!(
                "({} - {})",
                self.display_node(left)?,
                self.display_node(right)?
            ),
            ExpressionNode::Multiply { value, scalar } => format!(
                "({} * {})",
                self.display_node(value)?,
                self.display_node(scalar)?
            ),
            ExpressionNode::Divide { value, scalar } => format!(
                "({} / {})",
                self.display_node(value)?,
                self.display_node(scalar)?
            ),
        })
    }

    fn compile_node(
        &self,
        field: &str,
        source: &str,
        node: &RawNode,
        expected: QuantityKind,
    ) -> Result<ExpressionNode, ParameterDiagnostic> {
        match node {
            RawNode::Atom { span } => self.compile_atom(field, source, *span, expected),
            RawNode::Negate { value, .. } => Ok(ExpressionNode::Multiply {
                value: Box::new(self.compile_node(field, source, value, expected)?),
                scalar: Box::new(ExpressionNode::Literal {
                    value: Quantity::ScalarMillionths(-1_000_000),
                }),
            }),
            RawNode::Add { left, right } => Ok(ExpressionNode::Add {
                left: Box::new(self.compile_node(field, source, left, expected)?),
                right: Box::new(self.compile_node(field, source, right, expected)?),
            }),
            RawNode::Subtract { left, right } => Ok(ExpressionNode::Subtract {
                left: Box::new(self.compile_node(field, source, left, expected)?),
                right: Box::new(self.compile_node(field, source, right, expected)?),
            }),
            RawNode::Multiply { left, right, span } => {
                let value_then_scalar = (|| -> Result<ExpressionNode, ParameterDiagnostic> {
                    Ok(ExpressionNode::Multiply {
                        value: Box::new(self.compile_node(field, source, left, expected)?),
                        scalar: Box::new(self.compile_node(
                            field,
                            source,
                            right,
                            QuantityKind::Scalar,
                        )?),
                    })
                })();
                match value_then_scalar {
                    Ok(node) => Ok(node),
                    Err(first_error) => match (|| -> Result<ExpressionNode, ParameterDiagnostic> {
                        Ok(ExpressionNode::Multiply {
                            value: Box::new(self.compile_node(field, source, right, expected)?),
                            scalar: Box::new(self.compile_node(
                                field,
                                source,
                                left,
                                QuantityKind::Scalar,
                            )?),
                        })
                    })() {
                        Ok(node) => Ok(node),
                        Err(_) => Err(ParameterDiagnostic {
                            span: Some(*span),
                            ..first_error
                        }),
                    },
                }
            }
            RawNode::Divide { left, right, span } => {
                let value = self.compile_node(field, source, left, expected)?;
                let scalar = self
                    .compile_node(field, source, right, QuantityKind::Scalar)
                    .map_err(|mut error| {
                        error.span = Some(*span);
                        error
                    })?;
                Ok(ExpressionNode::Divide {
                    value: Box::new(value),
                    scalar: Box::new(scalar),
                })
            }
        }
    }

    fn compile_atom(
        &self,
        field: &str,
        source: &str,
        span: ExpressionSpan,
        expected: QuantityKind,
    ) -> Result<ExpressionNode, ParameterDiagnostic> {
        let text = source[span.start..span.end].trim();
        let matches: Vec<_> = self
            .parameters
            .values()
            .filter(|parameter| parameter.display_name == text)
            .collect();
        match matches.as_slice() {
            [parameter] => {
                if parameter.kind != expected {
                    return Err(diagnostic(
                        field,
                        ParameterDiagnosticCode::KindMismatch,
                        Some(span),
                        format!(
                            "parameter {text:?} is {:?}, but this operand requires {:?}",
                            parameter.kind, expected
                        ),
                    ));
                }
                return Ok(ExpressionNode::Parameter {
                    id: parameter.id.clone(),
                });
            }
            [] => {}
            _ => {
                let mut candidates: Vec<_> = matches
                    .iter()
                    .map(|parameter| parameter.id.clone())
                    .collect();
                candidates.sort();
                return Err(ParameterDiagnostic {
                    code: ParameterDiagnosticCode::AmbiguousName,
                    field: field.to_owned(),
                    span: Some(span),
                    message: format!("parameter name {text:?} is ambiguous").into_boxed_str(),
                    candidates,
                    cycle: Vec::new(),
                });
            }
        }

        match parse_quantity(field, text, expected) {
            Ok(value) => Ok(ExpressionNode::Literal { value }),
            Err(error) if starts_like_quantity(text) => Err(quantity_diagnostic(error, span)),
            Err(_) => Err(diagnostic(
                field,
                ParameterDiagnosticCode::UnknownName,
                Some(span),
                format!("unknown parameter name {text:?}"),
            )),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum RawNode {
    Atom {
        span: ExpressionSpan,
    },
    Negate {
        value: Box<Self>,
        span: ExpressionSpan,
    },
    Add {
        left: Box<Self>,
        right: Box<Self>,
    },
    Subtract {
        left: Box<Self>,
        right: Box<Self>,
    },
    Multiply {
        left: Box<Self>,
        right: Box<Self>,
        span: ExpressionSpan,
    },
    Divide {
        left: Box<Self>,
        right: Box<Self>,
        span: ExpressionSpan,
    },
}

struct SourceParser<'a> {
    field: &'a str,
    source: &'a str,
    position: usize,
}

impl<'a> SourceParser<'a> {
    fn new(field: &'a str, source: &'a str) -> Self {
        Self {
            field,
            source,
            position: 0,
        }
    }

    fn parse(mut self) -> Result<RawNode, ParameterDiagnostic> {
        self.skip_whitespace();
        if self.position == self.source.len() {
            return Err(diagnostic(
                self.field,
                ParameterDiagnosticCode::EmptyExpression,
                Some(ExpressionSpan { start: 0, end: 0 }),
                "enter a value or parameter expression".to_owned(),
            ));
        }
        let root = self.parse_additive()?;
        self.skip_whitespace();
        if self.position != self.source.len() {
            return Err(self.syntax_error(
                ParameterDiagnosticCode::UnexpectedToken,
                self.position,
                self.next_char_end(),
                "unexpected token",
            ));
        }
        Ok(root)
    }

    fn parse_additive(&mut self) -> Result<RawNode, ParameterDiagnostic> {
        let mut left = self.parse_multiplicative()?;
        loop {
            self.skip_whitespace();
            let operator = self.peek_char();
            if !matches!(operator, Some('+') | Some('-')) {
                return Ok(left);
            }
            self.advance_char();
            let right = self.parse_multiplicative()?;
            left = if operator == Some('+') {
                RawNode::Add {
                    left: Box::new(left),
                    right: Box::new(right),
                }
            } else {
                RawNode::Subtract {
                    left: Box::new(left),
                    right: Box::new(right),
                }
            };
        }
    }

    fn parse_multiplicative(&mut self) -> Result<RawNode, ParameterDiagnostic> {
        let mut left = self.parse_unary()?;
        loop {
            self.skip_whitespace();
            let operator_start = self.position;
            let operator = self.peek_char();
            if !matches!(operator, Some('*') | Some('/')) {
                return Ok(left);
            }
            self.advance_char();
            let operator_end = self.position;
            let right = self.parse_unary()?;
            let span = ExpressionSpan {
                start: operator_start,
                end: operator_end,
            };
            left = if operator == Some('*') {
                RawNode::Multiply {
                    left: Box::new(left),
                    right: Box::new(right),
                    span,
                }
            } else {
                RawNode::Divide {
                    left: Box::new(left),
                    right: Box::new(right),
                    span,
                }
            };
        }
    }

    fn parse_unary(&mut self) -> Result<RawNode, ParameterDiagnostic> {
        self.skip_whitespace();
        if matches!(self.peek_char(), Some('+') | Some('-')) {
            let start = self.position;
            let negative = self.peek_char() == Some('-');
            self.advance_char();
            let value = self.parse_unary()?;
            if negative {
                return Ok(RawNode::Negate {
                    value: Box::new(value),
                    span: ExpressionSpan {
                        start,
                        end: self.position,
                    },
                });
            }
            return Ok(value);
        }
        self.parse_primary()
    }

    fn parse_primary(&mut self) -> Result<RawNode, ParameterDiagnostic> {
        self.skip_whitespace();
        if self.peek_char() == Some('(') {
            let start = self.position;
            self.advance_char();
            let node = self.parse_additive()?;
            self.skip_whitespace();
            if self.peek_char() != Some(')') {
                return Err(self.syntax_error(
                    ParameterDiagnosticCode::MissingClosingParenthesis,
                    start,
                    self.position,
                    "missing closing parenthesis",
                ));
            }
            self.advance_char();
            return Ok(node);
        }

        let start = self.position;
        while let Some(character) = self.peek_char() {
            if matches!(character, '+' | '-' | '*' | '/' | '(' | ')') {
                break;
            }
            self.advance_char();
        }
        let end = self.position;
        let trimmed_start = self.source[start..end]
            .find(|character: char| !character.is_whitespace())
            .map_or(end, |offset| start + offset);
        let trimmed_end = self.source[start..end]
            .rfind(|character: char| !character.is_whitespace())
            .map_or(trimmed_start, |offset| {
                start
                    + offset
                    + self.source[start + offset..]
                        .chars()
                        .next()
                        .unwrap()
                        .len_utf8()
            });
        if trimmed_start == trimmed_end {
            return Err(self.syntax_error(
                ParameterDiagnosticCode::UnexpectedToken,
                start,
                self.next_char_end(),
                "expected a value, parameter name, or parenthesized expression",
            ));
        }
        Ok(RawNode::Atom {
            span: ExpressionSpan {
                start: trimmed_start,
                end: trimmed_end,
            },
        })
    }

    fn skip_whitespace(&mut self) {
        while self.peek_char().is_some_and(char::is_whitespace) {
            self.advance_char();
        }
    }

    fn peek_char(&self) -> Option<char> {
        self.source[self.position..].chars().next()
    }

    fn advance_char(&mut self) {
        if let Some(character) = self.peek_char() {
            self.position += character.len_utf8();
        }
    }

    fn next_char_end(&self) -> usize {
        self.peek_char().map_or(self.position, |character| {
            self.position + character.len_utf8()
        })
    }

    fn syntax_error(
        &self,
        code: ParameterDiagnosticCode,
        start: usize,
        end: usize,
        message: &str,
    ) -> ParameterDiagnostic {
        diagnostic(
            self.field,
            code,
            Some(ExpressionSpan { start, end }),
            message.to_owned(),
        )
    }
}

fn starts_like_quantity(text: &str) -> bool {
    matches!(
        text.trim_start().chars().next(),
        Some('+' | '-' | '.' | '0'..='9')
    )
}

fn diagnostic(
    field: &str,
    code: ParameterDiagnosticCode,
    span: Option<ExpressionSpan>,
    message: String,
) -> ParameterDiagnostic {
    ParameterDiagnostic {
        code,
        field: field.to_owned(),
        span,
        message: message.into_boxed_str(),
        candidates: Vec::new(),
        cycle: Vec::new(),
    }
}

fn quantity_diagnostic(error: QuantityError, span: ExpressionSpan) -> ParameterDiagnostic {
    diagnostic(
        &error.field,
        ParameterDiagnosticCode::InvalidQuantity,
        Some(span),
        error.message,
    )
}

fn evaluation_diagnostic(field: &str, error: ParameterError) -> ParameterDiagnostic {
    let code = match &error {
        ParameterError::Cycle { .. } => ParameterDiagnosticCode::Cycle,
        ParameterError::KindMismatch { .. } => ParameterDiagnosticCode::KindMismatch,
        ParameterError::IncompatibleOperands { .. } => {
            ParameterDiagnosticCode::IncompatibleOperands
        }
        ParameterError::ExpectedScalar(_) => ParameterDiagnosticCode::ExpectedScalar,
        ParameterError::DivisionByZero => ParameterDiagnosticCode::DivisionByZero,
        ParameterError::Overflow | ParameterError::InexactOrOverflow => {
            ParameterDiagnosticCode::InexactOrOverflow
        }
        _ => ParameterDiagnosticCode::Evaluation,
    };
    let cycle = match &error {
        ParameterError::Cycle { path } => path.clone(),
        _ => Vec::new(),
    };
    ParameterDiagnostic {
        code,
        field: field.to_owned(),
        span: None,
        message: error.to_string().into_boxed_str(),
        candidates: Vec::new(),
        cycle,
    }
}

fn add(left: Quantity, right: Quantity) -> Result<Quantity, ParameterError> {
    binary_same_kind(left, right, i128::checked_add)
}

fn subtract(left: Quantity, right: Quantity) -> Result<Quantity, ParameterError> {
    binary_same_kind(left, right, i128::checked_sub)
}

fn binary_same_kind(
    left: Quantity,
    right: Quantity,
    operation: fn(i128, i128) -> Option<i128>,
) -> Result<Quantity, ParameterError> {
    if left.kind() != right.kind() {
        return Err(ParameterError::IncompatibleOperands {
            left: left.kind(),
            right: right.kind(),
        });
    }
    let result =
        operation(quantity_i128(left), quantity_i128(right)).ok_or(ParameterError::Overflow)?;
    quantity_from_i128(left.kind(), result)
}

fn scale(value: Quantity, scalar: Quantity, divide: bool) -> Result<Quantity, ParameterError> {
    let Quantity::ScalarMillionths(factor) = scalar else {
        return Err(ParameterError::ExpectedScalar(scalar.kind()));
    };
    if divide && factor == 0 {
        return Err(ParameterError::DivisionByZero);
    }
    let raw = quantity_i128(value);
    let scaled = if divide {
        raw.checked_mul(1_000_000)
            .and_then(|number| exact_divide(number, factor as i128))
    } else {
        raw.checked_mul(factor as i128)
            .and_then(|number| exact_divide(number, 1_000_000))
    }
    .ok_or(ParameterError::InexactOrOverflow)?;
    quantity_from_i128(value.kind(), scaled)
}

fn exact_divide(numerator: i128, denominator: i128) -> Option<i128> {
    (denominator != 0 && numerator % denominator == 0).then_some(numerator / denominator)
}

fn quantity_i128(value: Quantity) -> i128 {
    match value {
        Quantity::LengthNanometers(value)
        | Quantity::AngleMicrodegrees(value)
        | Quantity::ScalarMillionths(value) => value as i128,
        Quantity::Count(value) | Quantity::ToleranceNanometers(value) => value as i128,
    }
}

fn quantity_from_i128(kind: QuantityKind, value: i128) -> Result<Quantity, ParameterError> {
    Ok(match kind {
        QuantityKind::Length => {
            Quantity::LengthNanometers(i64::try_from(value).map_err(|_| ParameterError::Overflow)?)
        }
        QuantityKind::Angle => {
            Quantity::AngleMicrodegrees(i64::try_from(value).map_err(|_| ParameterError::Overflow)?)
        }
        QuantityKind::Scalar => {
            Quantity::ScalarMillionths(i64::try_from(value).map_err(|_| ParameterError::Overflow)?)
        }
        QuantityKind::Count => {
            Quantity::Count(u64::try_from(value).map_err(|_| ParameterError::Overflow)?)
        }
        QuantityKind::Tolerance => Quantity::ToleranceNanometers(
            u64::try_from(value).map_err(|_| ParameterError::Overflow)?,
        ),
    })
}

fn format_quantity(value: Quantity) -> String {
    match value {
        Quantity::LengthNanometers(value) => format!("{value} nm"),
        Quantity::AngleMicrodegrees(value) => format!("{value} udeg"),
        Quantity::Count(value) => value.to_string(),
        Quantity::ScalarMillionths(value) => format!("{value} millionths"),
        Quantity::ToleranceNanometers(value) => format!("{value} nm tolerance"),
    }
}

/// Stable expression error categories.
#[derive(Clone, Debug, Eq, PartialEq, Error)]
pub enum ParameterError {
    #[error("parameter id is empty")]
    InvalidId,
    #[error("field id is empty")]
    InvalidField,
    #[error("parameter display name is empty")]
    InvalidName,
    #[error("duplicate parameter {0:?}")]
    DuplicateParameter(NamedParameterId),
    #[error("unknown parameter {0:?}")]
    UnknownParameter(NamedParameterId),
    #[error("unknown field {0}")]
    UnknownField(String),
    #[error("parameter cycle: {path:?}")]
    Cycle { path: Vec<NamedParameterId> },
    #[error("parameter {parameter:?} expected {expected:?}, evaluated {actual:?}")]
    KindMismatch {
        parameter: NamedParameterId,
        expected: QuantityKind,
        actual: QuantityKind,
    },
    #[error("incompatible operands: {left:?} and {right:?}")]
    IncompatibleOperands {
        left: QuantityKind,
        right: QuantityKind,
    },
    #[error("scalar operand required, got {0:?}")]
    ExpectedScalar(QuantityKind),
    #[error("division by zero")]
    DivisionByZero,
    #[error("quantity overflow")]
    Overflow,
    #[error("operation is inexact in the stored base unit or overflowed")]
    InexactOrOverflow,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn promoted_value_drives_multiple_fields_by_stable_identity() {
        let set = ParameterSet::default()
            .promote_field(
                "sketch.width",
                NamedParameterId::from("parameter:width"),
                "Width",
                Quantity::LengthNanometers(20_000_000),
            )
            .unwrap();
        let mut reused = set.clone();
        reused.field_bindings.insert(
            "extrude.width".into(),
            FieldBinding {
                field_id: "extrude.width".into(),
                parameter: NamedParameterId::from("parameter:width"),
            },
        );
        assert_eq!(
            reused.field_value("sketch.width").unwrap(),
            Quantity::LengthNanometers(20_000_000)
        );
        assert_eq!(
            reused.field_value("extrude.width").unwrap(),
            Quantity::LengthNanometers(20_000_000)
        );
    }

    #[test]
    fn structural_references_survive_rename_and_display_current_name() {
        let base = ParameterSet::default()
            .promote_field(
                "width",
                NamedParameterId::from("p:width"),
                "Width",
                Quantity::LengthNanometers(10),
            )
            .unwrap()
            .promote_field(
                "double",
                NamedParameterId::from("p:double"),
                "Double Width",
                Quantity::LengthNanometers(20),
            )
            .unwrap();
        let expression = ParameterExpression {
            source: "Width * 2".into(),
            root: ExpressionNode::Multiply {
                value: Box::new(ExpressionNode::Parameter {
                    id: NamedParameterId::from("p:width"),
                }),
                scalar: Box::new(ExpressionNode::Literal {
                    value: Quantity::ScalarMillionths(2_000_000),
                }),
            },
        };
        let changed = base
            .set_expression(&NamedParameterId::from("p:double"), expression)
            .unwrap();
        let renamed = changed
            .rename(&NamedParameterId::from("p:width"), "Overall Width")
            .unwrap();
        assert_eq!(
            renamed.field_value("double").unwrap(),
            Quantity::LengthNanometers(20)
        );
        assert_eq!(
            renamed.parameters[&NamedParameterId::from("p:double")]
                .expression
                .source,
            "Width * 2"
        );
        assert_eq!(
            renamed
                .display_expression(&NamedParameterId::from("p:double"))
                .unwrap(),
            "(Overall Width * 2000000 millionths)"
        );
    }

    #[test]
    fn cycles_report_a_stable_dependency_path_and_leave_base_unchanged() {
        let base = ParameterSet::default()
            .promote_field(
                "a",
                NamedParameterId::from("p:a"),
                "A",
                Quantity::LengthNanometers(1),
            )
            .unwrap()
            .promote_field(
                "b",
                NamedParameterId::from("p:b"),
                "B",
                Quantity::LengthNanometers(2),
            )
            .unwrap();
        let a_to_b = ParameterExpression {
            source: "B".into(),
            root: ExpressionNode::Parameter {
                id: NamedParameterId::from("p:b"),
            },
        };
        let interim = base
            .set_expression(&NamedParameterId::from("p:a"), a_to_b)
            .unwrap();
        let b_to_a = ParameterExpression {
            source: "A".into(),
            root: ExpressionNode::Parameter {
                id: NamedParameterId::from("p:a"),
            },
        };
        let error = interim
            .set_expression(&NamedParameterId::from("p:b"), b_to_a)
            .unwrap_err();
        assert_eq!(
            error,
            ParameterError::Cycle {
                path: vec![
                    NamedParameterId::from("p:a"),
                    NamedParameterId::from("p:b"),
                    NamedParameterId::from("p:a")
                ]
            }
        );
        assert_eq!(
            base.field_value("a").unwrap(),
            Quantity::LengthNanometers(1)
        );
    }

    #[test]
    fn unit_mismatch_and_inexact_scaling_fail_closed() {
        assert!(matches!(
            add(
                Quantity::LengthNanometers(1),
                Quantity::AngleMicrodegrees(1)
            ),
            Err(ParameterError::IncompatibleOperands { .. })
        ));
        assert_eq!(
            scale(
                Quantity::LengthNanometers(1),
                Quantity::ScalarMillionths(500_000),
                false
            ),
            Err(ParameterError::InexactOrOverflow)
        );
    }

    #[test]
    fn canonical_serde_retains_source_and_stable_references() {
        let set = ParameterSet::default()
            .promote_field(
                "width",
                NamedParameterId::from("p:width"),
                "Width",
                Quantity::LengthNanometers(25_400_000),
            )
            .unwrap();
        let bytes = serde_json::to_vec(&set).unwrap();
        let restored: ParameterSet = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(restored, set);
        assert_eq!(serde_json::to_vec(&restored).unwrap(), bytes);
    }

    #[test]
    fn parses_parentheses_units_and_scalar_precedence_exactly() {
        let base = ParameterSet::default()
            .promote_field(
                "sketch.width",
                NamedParameterId::from("p:width"),
                "Width",
                Quantity::LengthNanometers(25_400_000),
            )
            .unwrap()
            .promote_field(
                "sketch.result",
                NamedParameterId::from("p:result"),
                "Result",
                Quantity::LengthNanometers(1),
            )
            .unwrap();

        let source = " 2 * (Width + 25.4 mm) / 2 ";
        let changed = base
            .set_expression_source(&NamedParameterId::from("p:result"), "sketch.result", source)
            .unwrap();
        let evaluated = changed
            .evaluated_parameter(&NamedParameterId::from("p:result"))
            .unwrap();
        assert_eq!(evaluated.source, source);
        assert_eq!(evaluated.value, Quantity::LengthNanometers(50_800_000));
    }

    #[test]
    fn parsed_display_names_become_stable_ids_and_survive_rename() {
        let base = ParameterSet::default()
            .promote_field(
                "width",
                NamedParameterId::from("p:width"),
                "Overall Width",
                Quantity::LengthNanometers(10_000_000),
            )
            .unwrap()
            .promote_field(
                "derived",
                NamedParameterId::from("p:derived"),
                "Derived",
                Quantity::LengthNanometers(1),
            )
            .unwrap();
        let parsed = base
            .parse_expression("derived", "Overall Width + 5 mm", QuantityKind::Length)
            .unwrap();
        assert!(matches!(
            parsed.root,
            ExpressionNode::Add { ref left, .. }
                if **left == ExpressionNode::Parameter {
                    id: NamedParameterId::from("p:width")
                }
        ));

        let changed = base
            .set_expression(&NamedParameterId::from("p:derived"), parsed)
            .unwrap()
            .rename(&NamedParameterId::from("p:width"), "Envelope Width")
            .unwrap();
        assert_eq!(
            changed.field_value("derived").unwrap(),
            Quantity::LengthNanometers(15_000_000)
        );
        assert_eq!(
            changed.parameters[&NamedParameterId::from("p:derived")]
                .expression
                .source,
            "Overall Width + 5 mm"
        );
        assert_eq!(
            changed
                .display_expression(&NamedParameterId::from("p:derived"))
                .unwrap(),
            "(Envelope Width + 5000000 nm)"
        );
    }

    #[test]
    fn unknown_and_ambiguous_names_report_the_edited_field() {
        let base = ParameterSet::default()
            .promote_field(
                "first",
                NamedParameterId::from("p:z"),
                "Shared",
                Quantity::LengthNanometers(1),
            )
            .unwrap()
            .promote_field(
                "second",
                NamedParameterId::from("p:a"),
                "Shared",
                Quantity::LengthNanometers(2),
            )
            .unwrap();
        let ambiguous = base
            .parse_expression("pad.distance", "Shared", QuantityKind::Length)
            .unwrap_err();
        assert_eq!(ambiguous.code, ParameterDiagnosticCode::AmbiguousName);
        assert_eq!(ambiguous.field, "pad.distance");
        assert_eq!(
            ambiguous.candidates,
            vec![NamedParameterId::from("p:a"), NamedParameterId::from("p:z")]
        );

        let unknown = base
            .parse_expression("pad.distance", "Missing Width", QuantityKind::Length)
            .unwrap_err();
        assert_eq!(unknown.code, ParameterDiagnosticCode::UnknownName);
        assert_eq!(unknown.field, "pad.distance");
        assert_eq!(unknown.span, Some(ExpressionSpan { start: 0, end: 13 }));
    }

    #[test]
    fn source_edits_reject_cycles_atomically_with_a_stable_path() {
        let base = ParameterSet::default()
            .promote_field(
                "a",
                NamedParameterId::from("p:a"),
                "A",
                Quantity::LengthNanometers(1),
            )
            .unwrap()
            .promote_field(
                "b",
                NamedParameterId::from("p:b"),
                "B",
                Quantity::LengthNanometers(2),
            )
            .unwrap();
        let interim = base
            .set_expression_source(&NamedParameterId::from("p:a"), "field.a", "B")
            .unwrap();
        let error = interim
            .set_expression_source(&NamedParameterId::from("p:b"), "field.b", "A")
            .unwrap_err();
        assert_eq!(error.code, ParameterDiagnosticCode::Cycle);
        assert_eq!(error.field, "field.b");
        assert_eq!(
            error.cycle,
            vec![
                NamedParameterId::from("p:a"),
                NamedParameterId::from("p:b"),
                NamedParameterId::from("p:a")
            ]
        );
        assert_eq!(
            interim.field_value("b").unwrap(),
            Quantity::LengthNanometers(2)
        );
    }

    #[test]
    fn syntax_quantity_kind_and_evaluation_diagnostics_are_field_specific() {
        let base = ParameterSet::default()
            .promote_field(
                "length",
                NamedParameterId::from("p:length"),
                "Length",
                Quantity::LengthNanometers(10),
            )
            .unwrap();
        let missing_parenthesis = base
            .parse_expression("pad.distance", "(Length + 1 mm", QuantityKind::Length)
            .unwrap_err();
        assert_eq!(
            missing_parenthesis.code,
            ParameterDiagnosticCode::MissingClosingParenthesis
        );
        assert_eq!(missing_parenthesis.field, "pad.distance");

        let wrong_unit = base
            .parse_expression("pad.distance", "5 deg", QuantityKind::Length)
            .unwrap_err();
        assert_eq!(wrong_unit.code, ParameterDiagnosticCode::InvalidQuantity);
        assert_eq!(wrong_unit.field, "pad.distance");

        let division_by_zero = base
            .set_expression_source(
                &NamedParameterId::from("p:length"),
                "pad.distance",
                "10 nm / 0",
            )
            .unwrap_err();
        assert_eq!(
            division_by_zero.code,
            ParameterDiagnosticCode::DivisionByZero
        );
        assert_eq!(division_by_zero.field, "pad.distance");
    }
}
