export interface RecordAlertMediaAccessRequestDto {
  action: "PLAY_STARTED" | "FULLSCREEN_ENTERED";
  interactionId: string;
}
