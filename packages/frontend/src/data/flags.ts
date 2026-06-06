// Round country-flag assets, served self-hosted from /flags (copied from
// circle-flags by the predev/prebuild hooks). An unset or unknown code falls
// back to the neutral xx placeholder.

export function flagUrl(code: string | null | undefined): string {
  return `/flags/${code ?? "xx"}.svg`;
}
