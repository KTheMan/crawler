use thiserror::Error;

/// Failures produced while decoding or executing a worker command.
#[derive(Debug, Error)]
pub enum WorkerError {
    /// The command JSON could not be decoded.
    #[error("invalid command envelope: {0}")]
    InvalidEnvelope(#[from] serde_json::Error),
}
