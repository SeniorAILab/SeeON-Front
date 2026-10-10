import {
  canAdministerEdgeCredentials as canAdministerEdgeCredentialsEndpoint,
  issueEdgeCredential as issueEdgeCredentialEndpoint,
  listEdgeCredentials as listEdgeCredentialsEndpoint,
  revokeEdgeCredential as revokeEdgeCredentialEndpoint,
  rotateEdgeCredential as rotateEdgeCredentialEndpoint,
} from "./api/edgeEnrollments";
import {
  replaceEdgeInstallation as replaceEdgeInstallationEndpoint,
  transferEdgeOwnership as transferEdgeOwnershipEndpoint,
} from "./api/edgeInstallationAdmin";
import { parseOwnershipTransferKind as parseOwnershipTransferKindEndpoint } from "./api/edgeInstallationAdminParsers";

export function canAdministerEdgeCredentials(
  role: Parameters<typeof canAdministerEdgeCredentialsEndpoint>[0],
): ReturnType<typeof canAdministerEdgeCredentialsEndpoint> {
  return canAdministerEdgeCredentialsEndpoint(role);
}

export function issueEdgeCredential(
  request: Parameters<typeof issueEdgeCredentialEndpoint>[0],
): ReturnType<typeof issueEdgeCredentialEndpoint> {
  return issueEdgeCredentialEndpoint(request);
}

export function listEdgeCredentials(
  ...args: Parameters<typeof listEdgeCredentialsEndpoint>
): ReturnType<typeof listEdgeCredentialsEndpoint> {
  return listEdgeCredentialsEndpoint(...args);
}

export function revokeEdgeCredential(
  request: Parameters<typeof revokeEdgeCredentialEndpoint>[0],
): ReturnType<typeof revokeEdgeCredentialEndpoint> {
  return revokeEdgeCredentialEndpoint(request);
}

export function rotateEdgeCredential(
  request: Parameters<typeof rotateEdgeCredentialEndpoint>[0],
): ReturnType<typeof rotateEdgeCredentialEndpoint> {
  return rotateEdgeCredentialEndpoint(request);
}

export function replaceEdgeInstallation(
  request: Parameters<typeof replaceEdgeInstallationEndpoint>[0],
): ReturnType<typeof replaceEdgeInstallationEndpoint> {
  return replaceEdgeInstallationEndpoint(request);
}

export function transferEdgeOwnership(
  request: Parameters<typeof transferEdgeOwnershipEndpoint>[0],
): ReturnType<typeof transferEdgeOwnershipEndpoint> {
  return transferEdgeOwnershipEndpoint(request);
}

export function parseOwnershipTransferKind(
  value: Parameters<typeof parseOwnershipTransferKindEndpoint>[0],
): ReturnType<typeof parseOwnershipTransferKindEndpoint> {
  return parseOwnershipTransferKindEndpoint(value);
}

export {
  EdgeEnrollmentResponseError,
  OneTimeCredential,
} from "@/lib/edgeCredential";
export type {
  EdgeCredentialLifecycle,
  RedactedEdgeCredential,
} from "@/types/edgeEnrollment";
export type { OwnershipTransferManifestItem } from "@/types/edgeInstallationAdmin";
