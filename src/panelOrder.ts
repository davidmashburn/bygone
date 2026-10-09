/** A move is valid only for the exact displayed set/order that initiated it. */
export interface PanelMove {
    panelId: string;
    targetIndex: number;
    panelIds: string[];
}

export function moveComparisonPanel<T extends { id: string }>(panels: readonly T[], move: PanelMove): T[] | null {
    if (!Array.isArray(move.panelIds) || move.panelIds.length !== panels.length
        || !panels.every((panel, index) => panel.id === move.panelIds[index])
        || new Set(move.panelIds).size !== panels.length
        || !Number.isInteger(move.targetIndex) || move.targetIndex < 0 || move.targetIndex >= panels.length) return null;
    const from = panels.findIndex(panel => panel.id === move.panelId);
    if (from < 0 || from === move.targetIndex) return null;
    const result = [...panels];
    result.splice(move.targetIndex, 0, result.splice(from, 1)[0]);
    return result;
}

/** Custom order never changes membership or the canonical comparison range. */
export function applyComparisonOrder<T>(items: readonly T[], order: unknown, key: (item: T) => string): T[] {
    if (!Array.isArray(order) || order.length !== items.length || new Set(order).size !== items.length) return [...items];
    const byKey = new Map(items.map(item => [key(item), item]));
    return order.every(id => byKey.has(id)) ? order.map(id => byKey.get(id)!) : [...items];
}

export function movedPanelPairIndex(panelIds: readonly string[], panelId: string): number | null {
    return panelIds.length < 2 ? null : Math.min(Math.max(0, panelIds.indexOf(panelId)), panelIds.length - 2);
}
