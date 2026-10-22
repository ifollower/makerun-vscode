export function formatDuration(milliseconds: number | undefined): string {
  if (milliseconds === undefined) {
    return '—';
  }
  const duration = Math.max(0, milliseconds);
  if (duration < 1000) {
    return `${Math.floor(duration)}ms`;
  }
  if (duration < 60_000) {
    return `${(Math.floor(duration / 100) / 10).toFixed(1)}s`;
  }
  const seconds = Math.floor(duration / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m ${seconds % 60}s`;
}
