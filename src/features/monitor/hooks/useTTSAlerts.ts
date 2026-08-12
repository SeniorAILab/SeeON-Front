import { useEffect, useMemo } from "react";
import { ttsManager, type TTSAlertInput } from "@/features/monitor/services/tts/ttsManager";
import type { DetectionEvent, Floor, Space, SpaceStatus } from "@/types";

/** Alert identity is the queue key; space state is only a fallback when no alert DTO exists. */
export function buildTTSAlerts(
  spaces: Space[],
  statuses: Record<string, SpaceStatus>,
  floors: Floor[],
  alerts: DetectionEvent[] = [],
): TTSAlertInput[] {
  const floorName = (id: string) => floors.find((floor) => floor.id === id)?.name ?? "";
  const spaceById = new Map(spaces.map((space) => [space.id, space]));
  const representedSpaces = new Set<string>();
  const seenIdentities = new Set<string>();
  const out: TTSAlertInput[] = [];

  for (const alert of alerts) {
    const identity = alert.backendEventId ?? alert.id;
    if (!identity || seenIdentities.has(identity)) continue;
    seenIdentities.add(identity);

    if (alert.testMode === "SYSTEM_TEST" && alert.eventType === "SYSTEM_TEST" && alert.ttsText) {
      out.push({
        identity,
        kind: "SYSTEM_TEST",
        spaceId: null,
        name: null,
        level: "CAUTION",
        reason: alert.label ?? "",
        floorName: null,
        testMode: "SYSTEM_TEST",
        ttsText: alert.ttsText,
      });
      continue;
    }

    if (!alert.spaceId) continue;
    const space = spaceById.get(alert.spaceId);
    if (!space) continue;
    representedSpaces.add(space.id);
    out.push({
      identity,
      kind: "INCIDENT",
      spaceId: space.id,
      name: space.name,
      level: alert.eventType === "FALL_RISK" || alert.emergency ? "EMERGENCY" : "DANGER",
      reason: alert.aiSummary ?? "",
      floorName: floorName(space.floorId),
    });
  }

  for (const space of spaces) {
    if (representedSpaces.has(space.id)) continue;
    const status = statuses[space.id];
    if (!status) continue;
    const common = {
      identity: `status:${status.id}`,
      kind: "INCIDENT" as const,
      spaceId: space.id,
      name: space.name,
      reason: status.aiSummary ?? "",
      floorName: floorName(space.floorId),
    };
    if (status.emergency) out.push({ ...common, level: "EMERGENCY" });
    else if (status.status === "DANGER") out.push({ ...common, level: "DANGER" });
    else if (status.status === "CAUTION" || status.status === "CHECK_NEEDED") {
      out.push({ ...common, level: "CAUTION" });
    }
  }
  return out;
}

export function useTTSAlerts(alerts: TTSAlertInput[], enabled: boolean) {
  const signature = useMemo(
    () => alerts
      .map((alert) => `${alert.identity}:${alert.kind}:${alert.level}:${alert.kind === "SYSTEM_TEST" ? alert.ttsText : ""}`)
      .sort()
      .join("|"),
    [alerts],
  );
  useEffect(() => {
    ttsManager.update(alerts, enabled);
    // The primitive signature intentionally owns synchronization identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, enabled]);
  useEffect(() => () => ttsManager.update([], false), []);
}
