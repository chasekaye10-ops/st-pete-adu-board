export function calculateMaxAdu(houseSf: number): number {
  return Math.min(800, Math.round(houseSf * 0.67));
}
