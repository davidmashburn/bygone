import { target as aliased, Receiver } from './lib';
import { publicTarget } from './api';

const unicodeMarker = '🦕';
const unicodeCall = '🦕' && aliased(3);
const callbackReference = aliased;
const receiver = new Receiver();

export function body(value: number): number {
  const localReference = publicTarget;
  return aliased(value) + localReference(value) + receiver.method(value);
}

export const topLevelCall = aliased(0);
export const mapped = [1].map(aliased);
export const higherOrder = (fn: (n: number) => number) => fn(2);
export const passedToHigherOrder = higherOrder(aliased);
export { callbackReference };
