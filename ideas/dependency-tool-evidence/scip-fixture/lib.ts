export function target(value: number): number {
  return value + 1;
}

export class Receiver {
  method(value: number): number {
    return target(value);
  }
}
