import { describe, expect, it } from "vitest";
import { EdgeEnrollmentResponseError } from "@/lib/edgeCredential";
import { readEdgeRefs } from "./edgeEnrollmentValidation";

describe("edge reference array validation", () => {
  it("returns the original array after validating every element", () => {
    const refs = ["floor:1", "room.2", "CAMERA_3", "x".repeat(64)];

    expect(readEdgeRefs({ refs }, "refs")).toBe(refs);
  });

  it.each([
    null,
    "floor:1",
    [1],
    [null],
    [""],
    [":floor"],
    ["valid", "has spaces"],
    ["x".repeat(65)],
  ])("preserves rejection and error identity for %j", (refs) => {
    expect(() => readEdgeRefs({ refs }, "refs")).toThrow(EdgeEnrollmentResponseError);
    expect(() => readEdgeRefs({ refs }, "refs")).toThrow(
      "Malformed edge enrollment response: refs must be an edge-ref array",
    );
  });
});
