/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

/**
 * Hand-written types for the untyped `@nap-sft/tablsx` dependency.
 * Covers only the surface pg-schemata consumes; anything untraced is
 * left as `unknown` on purpose.
 */
declare module '@nap-sft/tablsx' {
  export interface Cell {
    value: unknown;
    formula: string | null;
    type: string;
  }

  export interface Sheet {
    name: string;
    rows: unknown[][];
  }

  export interface Workbook {
    sheets: Sheet[];
  }

  export class SheetReader {
    get name(): string;
    get rowCount(): number;
    getRow(index: number): Cell[];
    getCell(row: number, col: number): Cell;
  }

  export class WorkbookReader {
    static fromBuffer(buffer: Buffer | Uint8Array): WorkbookReader;
    static fromWorkbook(workbook: Workbook): WorkbookReader;
    get sheetCount(): number;
    sheet(nameOrIndex: string | number): SheetReader;
  }

  export class SheetBuilder {
    setHeaders(headers: string[]): this;
    addRow(values: unknown[]): this;
    addRows(rows: unknown[][]): this;
    addObjects(
      objects: Record<string, unknown>[],
      options?: Record<string, unknown>
    ): this;
    build(): Sheet;
  }

  export class WorkbookBuilder {
    static create(): WorkbookBuilder;
    sheet(name: string): SheetBuilder;
    build(): Workbook;
  }

  export function writeXlsx(workbook: Workbook): Uint8Array;
}
