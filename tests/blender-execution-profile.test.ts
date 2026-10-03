import { spawnSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import { BLENDER_EXECUTION_PROFILE, blenderBackgroundArguments } from '../scripts/lib/blender-execution-profile';

describe('Blender execution argument boundary', () => {
  it('retains literal paths and confines the single-thread option before the script delimiter', () => {
    const args = ['source with spaces.glb', 'output;literal.glb', '--threads 8 $(literal).json'];
    const result = spawnSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', '--', ...blenderBackgroundArguments('audit with spaces.py', args)], { encoding: 'utf8', shell: false });
    expect(result.status, result.stderr).toBe(0);
    const observed = JSON.parse(result.stdout) as string[];
    const delimiter = observed.indexOf('--');
    expect(observed.slice(delimiter + 1)).toEqual(args);
    expect(observed[observed.indexOf('--threads') + 1]).toBe(String(BLENDER_EXECUTION_PROFILE.threads));
    expect(observed[observed.indexOf('--python') + 1]).toBe('audit with spaces.py');
    expect(observed.slice(0, delimiter).filter(value => value === '--threads')).toHaveLength(1);
  });
});
