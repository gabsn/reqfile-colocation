//! The SARIF report reqfile reads: a fail result per file that likely breaks
//! COLOCATION, a pass result per file judged fine, each with its probability.

use serde_json::{json, Value};

use crate::rules::Judgment;

/// At or above this probability a judgment is reported as a failure.
const FAIL_FROM: f64 = 0.5;

pub fn report(judgments: &[Judgment]) -> Value {
    let results: Vec<Value> = judgments
        .iter()
        .map(|j| {
            json!({
                "ruleId": "COLOCATION",
                "kind": if failed(j) { "fail" } else { "pass" },
                "level": if failed(j) { "error" } else { "none" },
                "message": { "text": j.message },
                "locations": [{ "physicalLocation": {
                    "artifactLocation": { "uri": j.path },
                    "region": { "startLine": 1 }
                }}],
                "properties": { "probability": j.probability }
            })
        })
        .collect();
    json!({
        "version": "2.1.0",
        "$schema": "https://json.schemastore.org/sarif-2.1.0.json",
        "runs": [{
            "tool": { "driver": {
                "name": env!("CARGO_PKG_NAME"),
                "version": env!("CARGO_PKG_VERSION"),
                "rules": [{ "id": "COLOCATION" }]
            }},
            "results": results
        }]
    })
}

pub fn failed(judgment: &Judgment) -> bool {
    judgment.probability >= FAIL_FROM
}
