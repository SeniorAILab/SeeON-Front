import { beforeEach, describe, expect, it, vi } from "vitest";
import * as enrollments from "./api/edgeEnrollments";
import * as installations from "./api/edgeInstallationAdmin";
import * as parsers from "./api/edgeInstallationAdminParsers";
import * as service from "./edgeAdminService";

vi.mock("./api/edgeEnrollments", () => ({
  canAdministerEdgeCredentials: vi.fn(),
  issueEdgeCredential: vi.fn(),
  listEdgeCredentials: vi.fn(),
  revokeEdgeCredential: vi.fn(),
  rotateEdgeCredential: vi.fn(),
}));
vi.mock("./api/edgeInstallationAdmin", () => ({
  replaceEdgeInstallation: vi.fn(),
  transferEdgeOwnership: vi.fn(),
}));
vi.mock("./api/edgeInstallationAdminParsers", () => ({
  parseOwnershipTransferKind: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
});

const signal = new AbortController().signal;
const mutation = { tokenId: "token-1", idempotencyKey: "mutation-1", signal };
const operation = {
  operationId: "operation-1",
  status: "SUCCEEDED" as const,
  createdAt: "2026-10-09T00:00:00.000Z",
  updatedAt: "2026-10-09T00:01:00.000Z",
};
const issueRequest = { facilityId: "facility-1", idempotencyKey: "issue-1", signal };
const replaceRequest = {
  edgeInstallationId: "installation-1",
  idempotencyKey: "replace-1",
  expectedEnrollmentGeneration: 2,
  newClientInstallationRef: "client-2",
  signal,
};

function delegationTests<Request extends { readonly signal?: AbortSignal }, Result>(
  name: string,
  endpoint: (request: Request) => Promise<Result>,
  workflow: (request: Request) => Promise<Result>,
  request: Request,
  makeResult: () => Result,
) {
  describe(name, () => {
    it("forwards the original request and signal and preserves promise/result identity", async () => {
      const value = makeResult();
      const promise = Promise.resolve(value);
      vi.mocked(endpoint).mockReturnValue(promise);

      const result = workflow(request);

      expect(endpoint).toHaveBeenCalledTimes(1);
      expect(endpoint).toHaveBeenCalledWith(request);
      expect(vi.mocked(endpoint).mock.calls[0][0]).toBe(request);
      expect(vi.mocked(endpoint).mock.calls[0][0].signal).toBe(signal);
      expect(result).toBe(promise);
      await expect(result).resolves.toBe(value);
    });

    it("preserves rejection identity without retrying or replacing the error", async () => {
      const error = new DOMException("Request aborted", "AbortError");
      vi.mocked(endpoint).mockRejectedValue(error);

      await expect(workflow(request)).rejects.toBe(error);
      expect(endpoint).toHaveBeenCalledTimes(1);
      expect(vi.mocked(endpoint).mock.calls[0][0]).toBe(request);
    });
  });
}

function issuedCredential() {
  return {
    kind: "initial" as const,
    operationId: operation.operationId,
    facilityCode: "care-home",
    edgeInstallationId: "installation-1",
    enrollmentGeneration: 1 as const,
    createdAt: operation.createdAt,
    oneTimeCredential: new service.OneTimeCredential("issued-secret"),
  };
}

function rotatedCredential() {
  return {
    kind: "initial" as const,
    operationId: operation.operationId,
    edgeInstallationId: "installation-1",
    enrollmentGeneration: 2,
    priorTokenId: mutation.tokenId,
    graceEndsAt: operation.updatedAt,
    oneTimeCredential: new service.OneTimeCredential("rotated-secret"),
  };
}

function replacedInstallation() {
  return {
    kind: "initial" as const,
    operation,
    edgeInstallationId: "installation-1",
    previousEnrollmentGeneration: 2,
    enrollmentGeneration: 3,
    installationState: "PENDING_CLAIM" as const,
    oneTimeCredential: new service.OneTimeCredential("replacement-secret"),
  };
}

delegationTests("issueEdgeCredential", enrollments.issueEdgeCredential, service.issueEdgeCredential, issueRequest, issuedCredential);
delegationTests("listEdgeCredentials", enrollments.listEdgeCredentials, service.listEdgeCredentials, {
  facilityId: "facility-1",
  lifecycle: "GRACE" as const,
  signal,
}, () => [{
  tokenId: mutation.tokenId,
  prefix: "edge_1",
  lifecycle: "GRACE" as const,
  edgeInstallationId: "installation-1",
  enrollmentGeneration: 2,
  createdAt: operation.createdAt,
  valueState: "not-returned" as const,
}]);
delegationTests("rotateEdgeCredential", enrollments.rotateEdgeCredential, service.rotateEdgeCredential, mutation, rotatedCredential);
delegationTests("revokeEdgeCredential", enrollments.revokeEdgeCredential, service.revokeEdgeCredential, {
  ...mutation,
  expectedLifecycle: "GRACE" as const,
}, () => ({ operationId: operation.operationId, tokenId: mutation.tokenId, revokedAt: operation.updatedAt }));
delegationTests("replaceEdgeInstallation", installations.replaceEdgeInstallation, service.replaceEdgeInstallation, replaceRequest, replacedInstallation);
delegationTests("transferEdgeOwnership", installations.transferEdgeOwnership, service.transferEdgeOwnership, {
  edgeInstallationId: "installation-1",
  idempotencyKey: "transfer-1",
  expectedEnrollmentGeneration: 2,
  expectedServerRevision: 7,
  manifestDigest: "manifest-digest",
  manifest: [{ kind: "ROOM" as const, edgeRef: "room-1", canonicalId: "canonical-room-1", parentCanonicalId: "floor-1" }],
  signal,
}, () => ({
  operation,
  edgeInstallationId: "installation-1",
  enrollmentGeneration: 2,
  serverRevision: 8,
  transferred: { floors: 0, rooms: 1, cameras: 0 },
  appliedAt: operation.updatedAt,
}));

describe("one-time credential lifetime", () => {
  it.each([
    ["issue", () => {
      const value = issuedCredential();
      vi.mocked(enrollments.issueEdgeCredential).mockResolvedValue(value);
      return { value, secret: "issued-secret", run: () => service.issueEdgeCredential(issueRequest) };
    }],
    ["rotate", () => {
      const value = rotatedCredential();
      vi.mocked(enrollments.rotateEdgeCredential).mockResolvedValue(value);
      return { value, secret: "rotated-secret", run: () => service.rotateEdgeCredential(mutation) };
    }],
    ["replace", () => {
      const value = replacedInstallation();
      vi.mocked(installations.replaceEdgeInstallation).mockResolvedValue(value);
      return { value, secret: "replacement-secret", run: () => service.replaceEdgeInstallation(replaceRequest) };
    }],
  ] as const)("does not consume or copy the %s secret", async (_name, setup) => {
    const { value, secret, run } = setup();
    const consume = vi.spyOn(value.oneTimeCredential, "consume");
    const clear = vi.spyOn(value.oneTimeCredential, "clear");
    const dispose = vi.spyOn(value.oneTimeCredential, "dispose");

    const result = await run();

    expect(result).toBe(value);
    expect(consume).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(dispose).not.toHaveBeenCalled();
    expect(value.oneTimeCredential.consume()).toBe(secret);
    expect(value.oneTimeCredential.consume()).toBeNull();
  });
});

describe("synchronous edge service operations", () => {
  it("delegates role policy rather than implementing a second role check", () => {
    vi.mocked(enrollments.canAdministerEdgeCredentials).mockReturnValue(true);

    expect(service.canAdministerEdgeCredentials("STAFF")).toBe(true);
    expect(enrollments.canAdministerEdgeCredentials).toHaveBeenCalledTimes(1);
    expect(enrollments.canAdministerEdgeCredentials).toHaveBeenCalledWith("STAFF");
  });

  it("preserves synchronous role-policy errors", () => {
    const error = new Error("Role policy unavailable");
    vi.mocked(enrollments.canAdministerEdgeCredentials).mockImplementation(() => { throw error; });
    let caught: unknown;

    try {
      service.canAdministerEdgeCredentials(null);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(error);
    expect(enrollments.canAdministerEdgeCredentials).toHaveBeenCalledTimes(1);
  });

  it("passes unknown parser input through without local validation", () => {
    const value = { kind: "ROOM" };
    vi.mocked(parsers.parseOwnershipTransferKind).mockReturnValue("ROOM");

    expect(service.parseOwnershipTransferKind(value)).toBe("ROOM");
    expect(parsers.parseOwnershipTransferKind).toHaveBeenCalledTimes(1);
    expect(parsers.parseOwnershipTransferKind).toHaveBeenCalledWith(value);
    expect(vi.mocked(parsers.parseOwnershipTransferKind).mock.calls[0][0]).toBe(value);
  });

  it("preserves the parser error object", () => {
    const error = new service.EdgeEnrollmentResponseError("unknown transfer kind");
    vi.mocked(parsers.parseOwnershipTransferKind).mockImplementation(() => { throw error; });
    let caught: unknown;

    try {
      service.parseOwnershipTransferKind("UNKNOWN");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(error);
    expect(parsers.parseOwnershipTransferKind).toHaveBeenCalledTimes(1);
    expect(parsers.parseOwnershipTransferKind).toHaveBeenCalledWith("UNKNOWN");
  });
});
