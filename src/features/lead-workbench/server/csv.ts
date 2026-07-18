import { companyInputSchema, type CompanyInput } from "../validation";

export type CsvImportError = Readonly<{
  row: number;
  message: string;
}>;

export type CompanyCsvParseResult = Readonly<{
  rows: CompanyInput[];
  errors: CsvImportError[];
}>;

function parseCsvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    const next = input[index + 1];

    if (character === '"') {
      if (quoted && next === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") {
        index += 1;
      }
      row.push(cell.trim());
      if (row.some((value) => value.length > 0)) {
        rows.push(row);
      }
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  if (quoted) {
    throw new Error("CSV contains an unterminated quoted field.");
  }

  row.push(cell.trim());
  if (row.some((value) => value.length > 0)) {
    rows.push(row);
  }

  return rows;
}

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function firstValue(
  record: Record<string, string>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (value) {
      return value;
    }
  }

  return undefined;
}

export function parseCompaniesCsv(input: string): CompanyCsvParseResult {
  if (input.length > 5_000_000) {
    throw new Error("CSV import is limited to 5 MB.");
  }

  const rows = parseCsvRows(input);
  const headers = rows.shift()?.map(normalizeHeader) ?? [];

  if (!headers.includes("name") && !headers.includes("company_name")) {
    throw new Error("CSV must include a `name` or `company_name` column.");
  }

  const parsed: CompanyInput[] = [];
  const errors: CsvImportError[] = [];

  rows.slice(0, 500).forEach((values, index) => {
    const record = Object.fromEntries(
      headers.map((header, headerIndex) => [header, values[headerIndex] ?? ""]),
    );
    const result = companyInputSchema.safeParse({
      name: firstValue(record, "name", "company_name"),
      website: firstValue(record, "website", "url"),
      industry: firstValue(record, "industry", "sector"),
      size: firstValue(record, "size", "company_size", "employees"),
      location: firstValue(record, "location", "hq_location", "city"),
      status: firstValue(record, "status") ?? "prospect",
    });

    if (result.success) {
      parsed.push(result.data);
    } else {
      errors.push({
        row: index + 2,
        message: result.error.issues.map((issue) => issue.message).join(" "),
      });
    }
  });

  if (rows.length > 500) {
    errors.push({ row: 502, message: "Only the first 500 rows were imported." });
  }

  return { rows: parsed, errors };
}
