import { fileURLToPath } from "node:url";

export function getEdgeProvisioningEvidenceDirectory(): string {
  return process.env.EDGE_PROVISIONING_EVIDENCE_DIR
    ?? fileURLToPath(new URL("../test-results/edge-provisioning/", import.meta.url));
}
