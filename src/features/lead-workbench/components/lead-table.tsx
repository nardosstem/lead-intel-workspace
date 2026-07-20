"use client";

import { Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { WorkbenchPageInfo } from "../types";

export type LeadTableColumn<T> = Readonly<{
  key: string;
  label: string;
  searchValue?: (row: T) => string;
  render: (row: T) => React.ReactNode;
}>;

export type LeadTableFilter<T> = Readonly<{
  key: string;
  label: string;
  value: (row: T) => string;
  options: ReadonlyArray<Readonly<{ label: string; value: string }>>;
}>;

export type LeadTableQuery = Readonly<{
  query: string;
  filters: Readonly<Record<string, string>>;
  page: number;
}>;

export function LeadTable<T extends { id: string }>({
  rows,
  columns,
  filters = [],
  searchPlaceholder = "Search leads…",
  emptyMessage = "No matching leads.",
  onSelect,
  pagination,
  onQueryChange,
  isLoading = false,
}: Readonly<{
  rows: T[];
  columns: LeadTableColumn<T>[];
  filters?: LeadTableFilter<T>[];
  searchPlaceholder?: string;
  emptyMessage?: string;
  onSelect?: (row: T) => void;
  pagination?: WorkbenchPageInfo;
  onQueryChange?: (query: LeadTableQuery) => void;
  isLoading?: boolean;
}>) {
  const [query, setQuery] = useState("");
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const queryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const serverSide = Boolean(pagination && onQueryChange);

  useEffect(() => {
    return () => {
      if (queryTimer.current) clearTimeout(queryTimer.current);
    };
  }, []);

  function scheduleQueryChange(
    nextQuery: string,
    nextFilters: Record<string, string>,
  ) {
    if (!onQueryChange) return;
    if (queryTimer.current) clearTimeout(queryTimer.current);
    queryTimer.current = setTimeout(() => {
      onQueryChange({ query: nextQuery, filters: nextFilters, page: 1 });
    }, 250);
  }

  const filteredRows = useMemo(() => {
    if (serverSide) return rows;
    const normalizedQuery = query.trim().toLowerCase();

    return rows.filter((row) => {
      const matchesQuery =
        !normalizedQuery ||
        columns.some((column) =>
          (column.searchValue?.(row) ?? "").toLowerCase().includes(normalizedQuery),
        );
      const matchesFilters = filters.every((filter) => {
        const selected = filterValues[filter.key];
        return !selected || filter.value(row) === selected;
      });
      return matchesQuery && matchesFilters;
    });
  }, [columns, filterValues, filters, query, rows, serverSide]);

  function clearFilters() {
    setQuery("");
    setFilterValues({});
    scheduleQueryChange("", {});
  }

  function changePage(page: number) {
    if (queryTimer.current) clearTimeout(queryTimer.current);
    onQueryChange?.({ query, filters: filterValues, page });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(event) => {
              const nextQuery = event.target.value;
              setQuery(nextQuery);
              scheduleQueryChange(nextQuery, filterValues);
            }}
            placeholder={searchPlaceholder}
            className="pl-9"
            aria-label={searchPlaceholder}
          />
        </div>
        {filters.map((filter) => (
          <Select
            key={filter.key}
            value={filterValues[filter.key] ?? ""}
            onValueChange={(value) => {
              const nextFilters = {
                ...filterValues,
                [filter.key]: value ?? "",
              };
              setFilterValues(nextFilters);
              scheduleQueryChange(query, nextFilters);
            }}
          >
            <SelectTrigger className="w-full sm:w-44" aria-label={filter.label}>
              <SlidersHorizontal className="size-3.5 text-muted-foreground" />
              <SelectValue placeholder={filter.label} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All {filter.label.toLowerCase()}</SelectItem>
              {filter.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ))}
        {(query || Object.values(filterValues).some(Boolean)) && (
          <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
            Clear
          </Button>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border" aria-busy={isLoading}>
        <Table className="min-w-[720px]">
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column.key}>{column.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-28 text-center">
                  <p className="text-sm text-muted-foreground">{emptyMessage}</p>
                </TableCell>
              </TableRow>
            ) : (
              filteredRows.map((row) => (
                <TableRow
                  key={row.id}
                  className={onSelect ? "cursor-pointer" : undefined}
                  onClick={() => onSelect?.(row)}
                  onKeyDown={(event) => {
                    if (onSelect && (event.key === "Enter" || event.key === " ")) {
                      event.preventDefault();
                      onSelect(row);
                    }
                  }}
                  tabIndex={onSelect ? 0 : undefined}
                >
                  {columns.map((column) => (
                    <TableCell key={`${row.id}-${column.key}`}>
                      {column.render(row)}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <p>
          {serverSide && pagination
            ? `Showing ${pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1}–${Math.min(pagination.page * pagination.pageSize, pagination.total)} of ${pagination.total} records`
            : `Showing ${filteredRows.length} of ${rows.length} records`}
          {isLoading ? " · Loading…" : ""}
        </p>
        {serverSide && pagination && pagination.pageCount > 1 ? (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => changePage(pagination.page - 1)}
              disabled={isLoading || pagination.page <= 1}
            >
              Previous
            </Button>
            <span aria-live="polite">Page {pagination.page} of {pagination.pageCount}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => changePage(pagination.page + 1)}
              disabled={isLoading || pagination.page >= pagination.pageCount}
            >
              Next
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
