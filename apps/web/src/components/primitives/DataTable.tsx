import type { ReactNode } from "react";
import styles from "./primitives.module.css";

type Column<Row> = {
  key: keyof Row;
  label: string;
  numeric?: boolean;
};

type Props<Row extends Record<string, ReactNode>> = {
  columns: Column<Row>[];
  rows: Row[];
  caption: string;
  id: string;
};

export function DataTable<Row extends Record<string, ReactNode>>({
  columns,
  rows,
  caption,
  id,
}: Props<Row>) {
  return (
    <div className={styles.tableWrap} data-od-id={id}>
      <table className={styles.table}>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={String(column.key)} data-numeric={column.numeric || undefined}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {columns.map((column) => (
                <td key={String(column.key)} data-numeric={column.numeric || undefined}>
                  {row[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
