/** Keep the existing Blender tangent algorithm; avoid parallel accumulation variation. */
export const BLENDER_EXECUTION_PROFILE = {
  schema: 'morphloom.blender-execution-profile/0.1',
  name: 'background-single-thread',
  threads: 1,
} as const;

export function blenderBackgroundArguments(script: string, arguments_: readonly string[]): string[] {
  return ['--background', '--threads', String(BLENDER_EXECUTION_PROFILE.threads),
    '--python-exit-code', '1', '--python', script, '--', ...arguments_];
}
