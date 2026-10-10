import type { Role } from "@/types";
import { requestJson } from "@/services/apiClient";
import type { IssueEdgeCredentialRequestDto } from "./edge-enrollments/dto/issue-edge-credential-request.dto";
import type { RotateEdgeCredentialRequestDto } from "./edge-enrollments/dto/rotate-edge-credential-request.dto";
import type { RevokeEdgeCredentialRequestDto } from "./edge-enrollments/dto/revoke-edge-credential-request.dto";
import type { ListEdgeCredentialsQueryDto } from "./edge-enrollments/dto/list-edge-credentials-query.dto";
import {
  parseIssueEdgeCredential,
  parseRedactedEdgeCredentials,
  parseRevokeEdgeCredential,
  parseRotateEdgeCredential,
} from "./edgeEnrollmentParsers";
import {
  type CredentialMutationRequest,
  type IssueEdgeCredentialRequest,
  type IssuedEdgeCredential,
  type ListEdgeCredentialsRequest,
  type RedactedEdgeCredential,
  type RevokeEdgeCredentialRequest,
  type RevokedEdgeCredential,
  type RotatedEdgeCredential,
} from "@/types/edgeEnrollment";
export {
  parseIssueEdgeCredential,
  parseRedactedEdgeCredentials,
  parseTopologyPreviewStatus,
} from "./edgeEnrollmentParsers";

export async function issueEdgeCredential(
  request: IssueEdgeCredentialRequest,
): Promise<IssuedEdgeCredential> {
  const body = await requestJson(
    "/admin/edge-credentials",
    mutationOptions({
      idempotencyKey: request.idempotencyKey,
      signal: request.signal,
      body: { schemaVersion: 1, facilityId: request.facilityId } satisfies IssueEdgeCredentialRequestDto,
    }),
  );
  return parseIssueEdgeCredential(body);
}

export async function listEdgeCredentials(
  request: ListEdgeCredentialsRequest = {},
): Promise<readonly RedactedEdgeCredential[]> {
  const query = new URLSearchParams();
  if (request.facilityId !== undefined)
    query.set("facilityId", request.facilityId satisfies ListEdgeCredentialsQueryDto["facilityId"]);
  if (request.lifecycle !== undefined)
    query.set("lifecycle", request.lifecycle satisfies ListEdgeCredentialsQueryDto["lifecycle"]);
  const suffix = query.size === 0 ? "" : `?${query.toString()}`;
  const options: RequestInit = { method: "GET" };
  if (request.signal !== undefined) options.signal = request.signal;
  return parseRedactedEdgeCredentials(
    await requestJson(`/admin/edge-credentials${suffix}`, options),
  );
}

export async function rotateEdgeCredential(
  request: CredentialMutationRequest,
): Promise<RotatedEdgeCredential> {
  const body = await requestJson(
    `/admin/edge-credentials/${encodeURIComponent(request.tokenId)}/rotate`,
    mutationOptions({
      idempotencyKey: request.idempotencyKey,
      signal: request.signal,
      body: { schemaVersion: 1, expectedLifecycle: "ACTIVE" } satisfies RotateEdgeCredentialRequestDto,
    }),
  );
  return parseRotateEdgeCredential(body);
}

export async function revokeEdgeCredential(
  request: RevokeEdgeCredentialRequest,
): Promise<RevokedEdgeCredential> {
  const body = await requestJson(
    `/admin/edge-credentials/${encodeURIComponent(request.tokenId)}/revoke`,
    mutationOptions({
      idempotencyKey: request.idempotencyKey,
      signal: request.signal,
      body: {
        schemaVersion: 1,
        expectedLifecycle: request.expectedLifecycle,
        reason: "ADMIN_REVOKED",
      } satisfies RevokeEdgeCredentialRequestDto,
    }),
  );
  return parseRevokeEdgeCredential(body);
}

export function canAdministerEdgeCredentials(role: Role | null): boolean {
  return role === "SUPER_ADMIN";
}

function mutationOptions(request: {
  readonly idempotencyKey: string;
  readonly signal: AbortSignal | undefined;
  readonly body:
    | IssueEdgeCredentialRequestDto
    | RotateEdgeCredentialRequestDto
    | RevokeEdgeCredentialRequestDto;
}): RequestInit {
  const options: RequestInit = {
    method: "POST",
    headers: { "Idempotency-Key": request.idempotencyKey },
    body: JSON.stringify(request.body),
  };
  if (request.signal !== undefined) options.signal = request.signal;
  return options;
}
