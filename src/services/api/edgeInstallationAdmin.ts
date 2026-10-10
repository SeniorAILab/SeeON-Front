import { requestJson } from "@/services/apiClient";
import { parseReplaceEdgeInstallation } from "./edgeEnrollmentCredentialParsers";
import { parseEdgeOwnershipTransfer } from "./edgeInstallationAdminParsers";
import type { ReplaceEdgeInstallationRequestDto } from "./edge-installations/dto/replace-edge-installation-request.dto";
import type { TransferEdgeOwnershipRequestDto } from "./edge-installations/dto/transfer-edge-ownership-request.dto";
import type {
  EdgeOwnershipTransfer,
  InstallationMutationRequest,
  ReplaceEdgeInstallationRequest,
  ReplacedEdgeInstallation,
  TransferEdgeOwnershipRequest,
} from "@/types/edgeInstallationAdmin";

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
      } satisfies ReplaceEdgeInstallationRequestDto),
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
      } satisfies TransferEdgeOwnershipRequestDto),
    ),
  );
}

function mutationOptions(
  request: InstallationMutationRequest,
  body: ReplaceEdgeInstallationRequestDto | TransferEdgeOwnershipRequestDto,
): RequestInit {
  const options: RequestInit = {
    method: "POST",
    headers: { "Idempotency-Key": request.idempotencyKey },
    body: JSON.stringify(body),
  };
  if (request.signal !== undefined) options.signal = request.signal;
  return options;
}
