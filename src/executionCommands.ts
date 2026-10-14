import type { ExecutionStep } from './execution';

/** Produce literal shell arguments; never evaluate recorded targets or values. */
export function formatExecutionCommands(steps: readonly ExecutionStep[], windows: boolean): string {
  const quote = (value: string): string => windows
    ? `'${value.replaceAll("'", "''")}'`
    : `'${value.replaceAll("'", "'\\''")}'`;
  const commands = steps.map((step) => {
    const { command } = step;
    const invocation = [command.executable, ...command.args].map(quote).join(' ');
    return windows
      ? `Set-Location -LiteralPath ${quote(command.cwd)}\n& ${invocation}`
      : `cd ${quote(command.cwd)} && ${invocation}`;
  });
  if (windows) {
    return `& {\n${commands.join('\nif ($LASTEXITCODE -ne 0) { return }\n')}\n}`;
  }
  return `(\n${commands.join(' &&\n')}\n)`;
}
