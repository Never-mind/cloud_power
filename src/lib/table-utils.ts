export type TableColumn = {
  key: string;
  label: string;
  defaultVisible?: boolean;
  sortable?: boolean;
  filterable?: boolean;
};

export type ColumnVisibility = Record<string, boolean>;

export function mergeColumnVisibility<T extends TableColumn>(
  columns: T[],
  overrides: ColumnVisibility,
): ColumnVisibility {
  return Object.fromEntries(
    columns.map((column) => [
      column.key,
      overrides[column.key] ?? column.defaultVisible !== false,
    ]),
  );
}

export function getVisibleColumns<T extends TableColumn>(
  columns: T[],
  visibility: ColumnVisibility,
): T[] {
  const merged = mergeColumnVisibility(columns, visibility);
  return columns.filter((column) => merged[column.key]);
}

export function getHiddenColumns<T extends TableColumn>(
  columns: T[],
  visibility: ColumnVisibility,
): T[] {
  const merged = mergeColumnVisibility(columns, visibility);
  return columns.filter((column) => !merged[column.key]);
}

export function buildExportHeaders(columns: TableColumn[]): string[] {
  return columns.map((column) => column.label);
}

export function getColumnSettingGroups<T extends TableColumn>(
  columns: T[],
  visibility: ColumnVisibility,
): { visible: T[]; hidden: T[] } {
  return {
    visible: getVisibleColumns(columns, visibility),
    hidden: getHiddenColumns(columns, visibility),
  };
}
