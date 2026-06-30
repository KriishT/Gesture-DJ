export type StemBackendMode = "auto" | "local" | "cloud";

export interface StemBackendInfo {
  ok: boolean;
  message: string;
  localGpu: boolean;
  cloud: boolean;
  serverCloudOnly: boolean;
}
