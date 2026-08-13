import { requestJson } from "@/services/apiClient";
import { parseReplaceEdgeInstallation } from "./edgeEnrollmentCredentialParsers";
import { parseEdgeOwnershipTransfer } from "./edgeInstallationAdminParsers";
import type {
  EdgeOwnershipTransfer,
  OwnershipTransferManifestItem,
  ReplacedEdgeInstallation,
} from "./edgeInstallationAdminTypes";

type InstallationMutationRequest = {
  readonly edgeInstallationId: string;
  readonly idempotencyKey: string;
  readonly signal?: AbortSignal;
};

export type ReplaceEdgeInstallationRequest = InstallationMutationRequest & {
  readonly expectedEnrollmentGeneration: number;
  readonly newClientInstallationRef: string;
};

export type TransferEdgeOwnershipRequest = InstallationMutationRequest & {
  readonly expectedEnrollmentGeneration: number;
  readonly expectedServerRevision: number;
  readonly manifestDigest: string;
  readonly manifest: readonly OwnershipTransferManifestItem[];
};

export async function replaceEdgeInstallation(
  request: ReplaceEdgeInstallationRequest,
): Promise<ReplacedEdgeInstallation> {
  return parseReplaceEdgeInstallation(
    await requestJson(
      `/admin/edge-installations/${encodeURIComponent(request.edgeInstallationId)}/replace`,
      mutationOptions(request, {
        schemaVersion: 1,
        expectedEnrollmentGeneration: request.expectedEnrollmentGeneration,
        newClientInstallationRef: request.newClientInstallationRef,
      }),
    ),
  );
}

export async function transferEdgeOwnership(
  request: TransferEdgeOwnershipRequest,
): Promise<EdgeOwnershipTransfer> {
  return parseEdgeOwnershipTransfer(
    await requestJson(
      `/admin/edge-installations/${encodeURIComponent(request.edgeInstallationId)}/transfers`,
      mutationOptions(request, {
        schemaVersion: 1,
        expectedEnrollmentGeneration: request.expectedEnrollmentGeneration,
        expectedServerRevision: request.expectedServerRevision,
        manifestDigest: request.manifestDigest,
        manifest: request.manifest,
      }),
    ),
  );
}

function mutationOptions(
  request: InstallationMutationRequest,
  body: object,
): RequestInit {
  const options: RequestInit = {
    method: "POST",
    headers: { "Idempotency-Key": request.idempotencyKey },
    body: JSON.stringify(body),
  };
  if (request.signal !== undefined) options.signal = request.signal;
  return options;
}
