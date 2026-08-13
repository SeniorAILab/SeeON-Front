import type {
  EdgeOperationSummary,
  OperationStatus,
  OwnershipTransferKind,
} from "./edgeEnrollmentTypes";
import { EdgeEnrollmentResponseError } from "./edgeEnrollmentTypes";
import type { EdgeOwnershipTransfer } from "./edgeInstallationAdminTypes";
import {
  readInstant,
  readNonnegativeInteger,
  readPositiveInteger,
  readRecord,
  readString,
  readUuid,
  readUuidV7,
  requireExactKeys,
  requireSchemaVersion,
} from "./edgeEnrollmentValidation";

export function parseEdgeOwnershipTransfer(
  value: unknown,
): EdgeOwnershipTransfer {
  const record = readRecord(value, "root");
  requireExactKeys(record, [
    "schemaVersion",
    "operation",
    "edgeInstallationId",
    "enrollmentGeneration",
    "serverRevision",
    "transferred",
    "appliedAt",
  ]);
  requireSchemaVersion(record);
  const transferred = readRecord(record.transferred, "transferred");
  requireExactKeys(transferred, ["floors", "rooms", "cameras"]);
  return {
    operation: parseOperation(record.operation),
    edgeInstallationId: readUuid(record, "edgeInstallationId"),
    enrollmentGeneration: readPositiveInteger(
      record,
      "enrollmentGeneration",
    ),
    serverRevision: readNonnegativeInteger(record, "serverRevision"),
    transferred: {
      floors: readNonnegativeInteger(transferred, "floors"),
      rooms: readNonnegativeInteger(transferred, "rooms"),
      cameras: readNonnegativeInteger(transferred, "cameras"),
    },
    appliedAt: readInstant(record, "appliedAt"),
  };
}

export function parseOwnershipTransferKind(value: unknown): OwnershipTransferKind {
  switch (value) {
    case "FLOOR":
    case "ROOM":
    case "CAMERA":
      return value;
    default:
      throw new EdgeEnrollmentResponseError("unknown transfer kind");
  }
}

function parseOperation(value: unknown): EdgeOperationSummary {
  const record = readRecord(value, "operation");
  requireExactKeys(record, ["operationId", "status", "createdAt", "updatedAt"]);
  return {
    operationId: readUuidV7(record, "operationId"),
    status: parseOperationStatus(readString(record, "status")),
    createdAt: readInstant(record, "createdAt"),
    updatedAt: readInstant(record, "updatedAt"),
  };
}

function parseOperationStatus(value: string): OperationStatus {
  switch (value) {
    case "PENDING":
    case "SUCCEEDED":
    case "FAILED":
    case "UNKNOWN":
      return value;
    default:
      throw new EdgeEnrollmentResponseError("unknown operation status");
  }
}
