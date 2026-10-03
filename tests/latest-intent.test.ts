import {describe,expect,it} from 'vitest';
import {createLatestIntentGate} from '../src/engine/latest-intent';
describe('async result intent ownership',()=>{
 it('only the newest token can publish, including after a cancel/restart',()=>{const gate=createLatestIntentGate(),a=gate.begin(),b=gate.begin();expect(gate.isCurrent(a)).toBe(false);expect(gate.isCurrent(b)).toBe(true);gate.cancel();expect(gate.isCurrent(b)).toBe(false);const c=gate.begin();expect(gate.isCurrent(a)).toBe(false);expect(gate.isCurrent(b)).toBe(false);expect(gate.isCurrent(c)).toBe(true);});
 it('isolates different viewers and repeated identical input intents',()=>{const a=createLatestIntentGate(),b=createLatestIntentGate(),first=a.begin(),other=b.begin(),repeat=a.begin();expect(repeat).not.toBe(first);expect(a.isCurrent(other)).toBe(false);expect(b.isCurrent(other)).toBe(true);a.cancel();expect(b.isCurrent(other)).toBe(true);});
 it('never accepts an absent or externally fabricated token',()=>{const gate=createLatestIntentGate();expect(gate.isCurrent(undefined as never)).toBe(false);expect(gate.isCurrent(Symbol('latest-intent'))).toBe(false);const current=gate.begin();expect(gate.isCurrent(Symbol('latest-intent'))).toBe(false);expect(gate.isCurrent(current)).toBe(true);});
});
