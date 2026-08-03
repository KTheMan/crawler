//! Versioned command adapter for Crawler's dedicated kernel worker.

mod engine;
mod errors;
mod mesh;
mod protocol;

pub use engine::{AcknowledgedState, WorkerEngine};
pub use errors::WorkerError;
pub use protocol::{
    BooleanMode, BoundsNm, CancellationMode, Command, CommandEnvelope, ErrorCode, Event,
    EventEnvelope, IndexComponentType, MeshQualification, MessageMetadata, PROTOCOL_VERSION,
    PrimitiveTopology, PrismDimensionsNm, RenderPacket, ResultPayload, StepImportResult,
    StepImportSettings, StepImportSummary,
};

/// Decodes one command and returns the ordered event stream as JSON.
pub fn dispatch_json(command_json: &str) -> Result<String, WorkerError> {
    let command = serde_json::from_str(command_json)?;
    let events = WorkerEngine::default().execute(command);
    serde_json::to_string(&events).map_err(WorkerError::from)
}

/// Stateful WASM adapter owned by one dedicated module worker.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen]
pub struct WasmKernelAdapter {
    engine: WorkerEngine,
}

/// WASM methods exposed to the module worker host.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen]
impl WasmKernelAdapter {
    /// Creates an adapter with no acknowledged document state.
    #[wasm_bindgen::prelude::wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            engine: WorkerEngine::default(),
        }
    }

    /// Decodes one command and returns its ordered event stream as JSON.
    #[wasm_bindgen::prelude::wasm_bindgen(js_name = dispatchJson)]
    pub fn dispatch_json(&mut self, command_json: &str) -> Result<String, wasm_bindgen::JsValue> {
        let command = serde_json::from_str(command_json)
            .map_err(|error| wasm_bindgen::JsValue::from_str(&error.to_string()))?;
        serde_json::to_string(&self.engine.execute(command))
            .map_err(|error| wasm_bindgen::JsValue::from_str(&error.to_string()))
    }
}

#[cfg(target_arch = "wasm32")]
impl Default for WasmKernelAdapter {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn json_adapter_returns_typed_health_events() {
        let input = json!({
            "protocol_version": PROTOCOL_VERSION,
            "request_id": "health-1",
            "document_id": "document-a",
            "document_revision": 0,
            "preview_generation": 0,
            "command": "health"
        });
        let output = dispatch_json(&input.to_string()).expect("valid health JSON must dispatch");
        let events: Vec<EventEnvelope> =
            serde_json::from_str(&output).expect("adapter output must be valid event JSON");

        assert!(matches!(events[0].event, Event::Accepted));
        assert!(matches!(
            events[1].event,
            Event::Result {
                result: ResultPayload::Health {
                    protocol_version: PROTOCOL_VERSION
                }
            }
        ));
    }
}
